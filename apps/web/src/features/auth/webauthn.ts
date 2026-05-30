// Browser-side WebAuthn helpers: convert between base64url (used by the API)
// and the ArrayBuffers required by the navigator.credentials API.

function base64urlToBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
}

type AllowCredential = { id: string; type?: string; transports?: string[] }

export async function performPasskeyAuthentication(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const source = { ...options } as Record<string, unknown>
  const requestOptions: PublicKeyCredentialRequestOptions = {
    ...(source as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64urlToBuffer(String(source.challenge)),
  }

  if (Array.isArray(source.allowCredentials)) {
    requestOptions.allowCredentials = (source.allowCredentials as AllowCredential[]).map(
      (credential) => ({
        id: base64urlToBuffer(credential.id),
        type: 'public-key',
        transports: credential.transports as AuthenticatorTransport[] | undefined,
      }),
    )
  }

  const assertion = (await navigator.credentials.get({
    publicKey: requestOptions,
  })) as PublicKeyCredential | null

  if (!assertion) {
    throw new Error('Passkey authentication was cancelled.')
  }

  const response = assertion.response as AuthenticatorAssertionResponse
  return {
    id: assertion.id,
    rawId: bufferToBase64url(assertion.rawId),
    type: assertion.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
    clientExtensionResults: assertion.getClientExtensionResults(),
  }
}
