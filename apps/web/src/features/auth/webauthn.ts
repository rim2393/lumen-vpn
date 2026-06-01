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
type ExcludeCredential = { id: string; type?: string; transports?: string[] }

function convertCredentialCreationOptions(
  options: Record<string, unknown>,
): PublicKeyCredentialCreationOptions {
  const source = { ...options } as Record<string, unknown>
  const user = source.user as Record<string, unknown> | undefined
  const creationOptions: PublicKeyCredentialCreationOptions = {
    ...(source as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64urlToBuffer(String(source.challenge)),
    user: {
      ...(user as unknown as PublicKeyCredentialUserEntity),
      id: base64urlToBuffer(String(user?.id ?? '')),
      name: String(user?.name ?? ''),
      displayName: String(user?.displayName ?? user?.name ?? ''),
    },
  }

  if (Array.isArray(source.excludeCredentials)) {
    creationOptions.excludeCredentials = (source.excludeCredentials as ExcludeCredential[]).map(
      (credential) => ({
        id: base64urlToBuffer(credential.id),
        type: 'public-key',
        transports: credential.transports as AuthenticatorTransport[] | undefined,
      }),
    )
  }

  return creationOptions
}

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

export async function performPasskeyRegistration(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const credential = (await navigator.credentials.create({
    publicKey: convertCredentialCreationOptions(options),
  })) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Passkey registration was cancelled.')
  }

  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bufferToBase64url(response.attestationObject),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      transports:
        typeof response.getTransports === 'function' ? response.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}
