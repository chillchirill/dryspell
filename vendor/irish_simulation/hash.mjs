// Node-only equivalent of the upstream @noble/hashes SHA-256 wrapper.
// Identical UTF-8 input, lowercase hex and little-endian uint32 seed semantics.
import {createHash} from 'node:crypto';
export function sha256Bytes(text) {return createHash('sha256').update(text,'utf8').digest();}
export function sha256Hex(text) {return sha256Bytes(text).toString('hex');}
export function sha256Uint32LE(text) {return sha256Bytes(text).readUInt32LE(0);}
