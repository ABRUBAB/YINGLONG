/**
 * Chrome DevTools Protocol virtual authenticator: a real platform-style passkey (CTAP2, internal
 * transport, resident keys, user verification always passing) with no prompts, so a test (or the demo
 * recording) runs the exact WebAuthn path a phone would. Each test gets a fresh authenticator.
 */
import type { BrowserContext, CDPSession, Page } from "@playwright/test";

export interface VirtualPasskey {
  cdp: CDPSession;
  authenticatorId: string;
  credentials(): Promise<Array<{ credentialId: string; rpId?: string; signCount: number; isResidentCredential: boolean }>>;
  remove(): Promise<void>;
}

export async function addVirtualPasskey(context: BrowserContext, page: Page): Promise<VirtualPasskey> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    cdp,
    authenticatorId,
    credentials: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials,
    remove: async () => {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    },
  };
}
