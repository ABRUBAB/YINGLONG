export { createPasskey, signHash, rpIdFor, currentRpId, passkeysSupported, PasskeyCancelledError, PasskeyServiceError, PRODUCTION_RP_ID } from "./webauthn";
export type { CreatedPasskey } from "./webauthn";
export {
  encodeWebAuthnSignature,
  splitClientDataJSON,
  parseDerSignature,
  normaliseS,
  keyIdHash,
  P256_N,
  P256_N_DIV_2,
  WEBAUTHN_SIGNATURE_ABI,
  PasskeyEncodingError,
} from "./encode";
export type { EncodedWebAuthnSignature, WebAuthnAssertion } from "./encode";
export { decodeWebAuthnSignature, verifyWebAuthnSignature, contractMessage, checkAuthFlags } from "./verify";
export { publicKeyFromAttestation, publicKeyFromSpki, parseAuthData, decodeCbor } from "./cose";
export { parseP256Spki, SpkiError } from "./spki";
export { b64urlEncode, b64urlDecode } from "./bytes";
