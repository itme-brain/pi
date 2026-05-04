import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const STEER_CUSTOM_TYPE = "runtime-steer";
const HIDDEN_STEER_TYPES = new Set([STEER_CUSTOM_TYPE, "small-model-steer"]);

export function hiddenSteer(pi: ExtensionAPI, reason: string, content: string): void {
  pi.sendMessage(
    {
      customType: STEER_CUSTOM_TYPE,
      content: `[runtime steer: ${reason}] ${content}`,
      display: false,
      details: { reason },
    },
    { triggerTurn: true, deliverAs: "steer" },
  );
}

export function isHiddenSteerMessage(message: any): boolean {
  return message?.role === "custom" && HIDDEN_STEER_TYPES.has(message.customType);
}
