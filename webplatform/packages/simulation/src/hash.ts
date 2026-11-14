import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex,utf8ToBytes } from '@noble/hashes/utils.js';

/** The same UTF-8 SHA-256 bytes used by the original Node engine; no browser polyfill. */
export function sha256Bytes(text:string):Uint8Array{return sha256(utf8ToBytes(text));}
export function sha256Hex(text:string):string{return bytesToHex(sha256Bytes(text));}
export function sha256Uint32LE(text:string):number{const bytes=sha256Bytes(text);return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0,true);}
