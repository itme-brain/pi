import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== "llamacpp") return;

    const payload = event.payload as Record<string, unknown>;

    if (payload.reasoning_effort !== "none") return;

    return {
      ...payload,

      // Instruct-mode overrides
      temperature: 0.7,
      top_p: 0.8,
      presence_penalty: 1.5,
    };
  });
}
