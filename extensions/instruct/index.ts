import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== "llama.cpp") return;

    const payload = event.payload as Record<string, unknown>;
    const chatTemplateKwargs = payload.chat_template_kwargs as
      | Record<string, unknown>
      | undefined;

    const thinkingDisabled =
      payload.reasoning_effort === "none" ||
      chatTemplateKwargs?.enable_thinking === false;

    if (!thinkingDisabled) return;

    return {
      ...payload,

      // Instruct-mode overrides
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      min_p: 0.0,
      presence_penalty: 1.5,
      repeat_penalty: 1.0,
    };
  });
}
