import { BASE64_CHUNK } from '../config/constants';

/** Float32Array → base64（裸小端字节，分块 btoa 防爆栈） */
export const float32ToBase64 = (data: Float32Array): string => {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
};

/** base64 → Float32Array，长度不符抛错 */
export const base64ToFloat32 = (b64: string): Float32Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength % 4 !== 0) throw new Error('高度场字节长度不是 4 的倍数');
  return new Float32Array(bytes.buffer.slice(0));
};
