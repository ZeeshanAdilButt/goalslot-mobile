#!/usr/bin/env node
// Guards the two delivery links that silently broke on 2026-08-16/17 and made
// a shipped feature invisible to the user for a full day.
//
// BACKGROUND — what actually happened, so the next person understands what
// this is defending:
//
//   1. The release APK on this machine was built at 21:27. The notification
//      center landed at 22:13. The binary the user installed therefore never
//      contained the feature, and no amount of restarting the app could have
//      produced it. Verified by extracting assets/index.android.bundle from
//      the APK and grepping the Hermes string table: `notificationsTriggerButton`
//      appeared 0 times, while strings from the commit just before the build
//      appeared normally.
//
//   2. The fallback path — OTA — had never worked either. The EAS project has
//      zero channels, so the `expo-channel-name: preview` header the binary
//      sends resolves to nothing and the update endpoint answers 404. The
//      launcher swallows that and boots the embedded bundle, so the failure is
//      completely silent on-device.
//
// Either break alone is invisible. Together they produced a day of "you said
// you built it and it isn't there". This script makes both loud.
//
// USAGE
//   node scripts/verify-build-freshness.mjs [--sentinel <string>] [--skip-apk]
//
// Run it after every local release build and in CI. Exits non-zero on failure
// so it can gate a release.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)))
const APK_PATH = join(APP_DIR, 'android/app/build/outputs/apk/release/app-release.apk')
const MANIFEST_PATH = join(APP_DIR, 'android/app/src/main/AndroidManifest.xml')

// A string that exists in the CURRENT source and is stable enough to grep for
// in a minified Hermes bundle. Style names survive minification (they're
// object keys in a StyleSheet.create call); local variable names do not.
const DEFAULT_SENTINEL = 'notificationsTriggerButton'

const args = process.argv.slice(2)
const sentinel = valueOf('--sentinel') ?? DEFAULT_SENTINEL
const skipApk = args.includes('--skip-apk')

function valueOf(flag) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined
}

const failures = []
const notes = []

// ---------------------------------------------------------------------------
// Check 1 — the built binary actually contains current JS.
// ---------------------------------------------------------------------------
function checkApkFreshness() {
  if (skipApk) {
    notes.push('APK check skipped (--skip-apk).')
    return
  }
  if (!existsSync(APK_PATH)) {
    notes.push(`No release APK at ${APK_PATH} — nothing to check. Build one before releasing.`)
    return
  }
  // Verify the sentinel is in the source at all first, otherwise a typo'd
  // sentinel reads as "the build is stale" and sends someone on a long hunt.
  let sourceHits = ''
  try {
    sourceHits = execFileSync('grep', ['-rl', sentinel, join(APP_DIR, 'app'), join(APP_DIR, 'src')], {
      encoding: 'utf8',
    })
  } catch {
    failures.push(
      `Sentinel ${JSON.stringify(sentinel)} is not present in app/ or src/ at all. ` +
        `Pick a string that exists in current source (--sentinel), or this check proves nothing.`,
    )
    return
  }

  const dir = mkdtempSync(join(tmpdir(), 'goalslot-apk-'))
  try {
    execFileSync('unzip', ['-o', '-q', APK_PATH, 'assets/index.android.bundle', '-d', dir])
    const bundle = join(dir, 'assets/index.android.bundle')
    const strings = execFileSync('strings', ['-a', bundle], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    if (strings.includes(sentinel)) {
      notes.push(`OK  embedded bundle contains ${JSON.stringify(sentinel)} (source: ${sourceHits.trim().split('\n')[0]})`)
    } else {
      failures.push(
        `STALE BINARY: the embedded JS bundle in\n    ${APK_PATH}\n  does NOT contain ${JSON.stringify(sentinel)}, ` +
          `which IS present in current source.\n  This APK predates the code you are trying to ship — rebuild it. ` +
          `Installing it will not deliver the current feature set.`,
      )
    }
  } catch (err) {
    failures.push(`Could not inspect the APK bundle: ${err.message}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Check 2 — the OTA channel the binary asks for actually exists.
// ---------------------------------------------------------------------------
function readAndroidUpdatesConfig() {
  const xml = readFileSync(MANIFEST_PATH, 'utf8')
  // Meta-data names carry the `expo.modules.updates.` prefix in the generated
  // manifest, so these match on suffix rather than the bare constant name.
  const url = /EXPO_UPDATE_URL"\s+android:value="([^"]+)"/.exec(xml)?.[1]
  const headersRaw = /UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"\s+android:value="([^"]+)"/.exec(xml)?.[1]
  let runtime = /EXPO_RUNTIME_VERSION"\s+android:value="([^"]+)"/.exec(xml)?.[1]
  // Prebuild writes the runtime version as a string resource reference
  // (`@string/expo_runtime_version`), not a literal — resolve it, because
  // sending that placeholder as a header would make this check test the wrong
  // thing and could pass or fail for reasons unrelated to the channel.
  if (runtime?.startsWith('@string/')) {
    const resName = runtime.slice('@string/'.length)
    const stringsPath = join(APP_DIR, 'android/app/src/main/res/values/strings.xml')
    const resolved = existsSync(stringsPath)
      ? new RegExp(`<string name="${resName}"[^>]*>([^<]+)</string>`).exec(readFileSync(stringsPath, 'utf8'))?.[1]
      : undefined
    runtime = resolved?.trim()
  }
  let channel
  if (headersRaw) {
    try {
      channel = JSON.parse(headersRaw.replace(/&quot;/g, '"'))['expo-channel-name']
    } catch {
      /* fall through to the missing-channel failure below */
    }
  }
  return { url, channel, runtime }
}

async function checkOtaChannel() {
  const { url, channel, runtime } = readAndroidUpdatesConfig()
  if (!url || !channel) {
    notes.push('No EXPO_UPDATE_URL / channel header in AndroidManifest.xml — OTA not configured; skipping.')
    return
  }
  const headers = {
    'expo-channel-name': channel,
    'expo-runtime-version': runtime ?? '1.0.0',
    'expo-platform': 'android',
    'expo-protocol-version': '1',
    'expo-api-version': '1',
    accept: 'multipart/mixed,application/expo+json,application/json',
  }
  let res
  try {
    res = await fetch(url, { headers })
  } catch (err) {
    notes.push(`Could not reach ${url} (${err.message}) — network-dependent check skipped.`)
    return
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (res.ok && contentType.includes('multipart/mixed')) {
    notes.push(`OK  update channel ${JSON.stringify(channel)} resolves (HTTP ${res.status}, ${contentType.split(';')[0]}).`)
    return
  }
  const body = (await res.text().catch(() => '')).slice(0, 300)
  failures.push(
    `OTA DELIVERY BROKEN: ${url}\n  with expo-channel-name: ${channel} returned HTTP ${res.status} ` +
      `(${contentType || 'no content-type'}).\n  ${body}\n` +
      `  Installed builds request this exact channel; if it does not resolve, every\n` +
      `  checkForUpdateAsync() fails silently and the app runs its embedded bundle forever.\n` +
      `  Fix: eas channel:create ${channel} && eas channel:edit ${channel} --branch ${channel}`,
  )
}

// ---------------------------------------------------------------------------

checkApkFreshness()
await checkOtaChannel()

for (const note of notes) console.log(note)
if (failures.length > 0) {
  console.error('\nBuild freshness check FAILED:\n')
  for (const f of failures) console.error(`- ${f}\n`)
  process.exit(1)
}
console.log('\nBuild freshness check passed.')
