// The tracker fast path: transcript in, typed intent and a resolved goal or
// task out, with no model round trip. See ./intent.ts for why this mirrors
// `jiffy-voice`'s contract rather than importing it, and ./resolve.ts for
// the three-way resolution the UI is required to handle.
//
// Deliberately NOT here: anything the open-ended assistant does. A spoken
// "move my study block to 7pm" is not a tracking command and must not be
// pattern-matched into one — it comes back UNKNOWN and the caller sends it
// to the Coach, which already parses, validates, and confirms proposals
// (packages/shared/src/coach/proposals.ts).

export * from './intent'
export * from './parse'
export * from './resolve'
