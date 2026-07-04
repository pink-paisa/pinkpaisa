import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Clock3, Image as ImageIcon, MessageSquareQuote, Rocket, ShieldCheck, Sparkles } from "lucide-react";

export const DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE = [
  "Use the uploaded image of my product as the base.",
  "",
  "Create a high-quality Instagram marketing creative for this product.",
  "",
  "Product details:",
  "- Product name: [Your Product Name]",
  "- Category: [e.g., Skincare / Perfume / Serum]",
  "- Target audience: [e.g., Men 20-35 / Women / Luxury buyers]",
  "- Key benefits: [e.g., Hydration, Glow, Anti-aging]",
  "- Brand tone: [Luxury / Minimal / Bold / Natural / Premium]",
  "",
  "Design requirements:",
  "- Keep the original product intact and realistic",
  "- Enhance lighting to make it premium and eye-catching",
  "- Add a clean, aesthetic background (suggest options if needed)",
  "- Include subtle props that match the product vibe (e.g., flowers, stones, water, fabric)",
  "- Add soft shadows and reflections for depth",
  "- Maintain a modern Instagram ad style",
  "",
  "- Keep the product as the hero on the left or center-left",
  "- Leave elegant negative space in the composition for a balanced premium look",
  "",
  "Style references:",
  "- Cinematic lighting",
  "- Soft gradients or neutral tones",
  "- Instagram luxury brand aesthetic",
  "- High contrast but elegant",
  "",
  "Output:",
  "- Portrait-friendly composition suitable for Instagram marketing",
  "- Ultra high resolution",
  "- Clean, minimal, premium look",
  "- No typography, no price stickers, no CTA button rendered directly inside the AI image",
].join("\n");

export type CampaignAutomationSettings = {
  campaign_mode: "manual" | "automatic";
  campaign_batch_hour_ist: number;
  campaign_batch_minute_ist: number;
  campaign_creative_mode: "template" | "ai_generated";
  campaign_ai_provider: string;
  campaign_ai_model: string;
  campaign_ai_image_quality: "low" | "medium" | "high";
  campaign_ai_prompt_template: string;
};

export type CampaignImageModelOption = {
  id: string;
  label: string;
  supports_reference_image: boolean;
  supports_text_to_image: boolean;
  cost_tier: "low" | "medium" | "high" | string;
};

export type CampaignImageProviderOption = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  coming_soon: boolean;
  default_model: string | null;
  models: CampaignImageModelOption[];
};

export type CampaignImageProviderRegistry = {
  providers: CampaignImageProviderOption[];
  defaults: {
    provider: string;
    model: string;
  };
};

export const DEFAULT_CAMPAIGN_IMAGE_PROVIDER_REGISTRY: CampaignImageProviderRegistry = {
  providers: [
    {
      key: "openai",
      label: "OpenAI",
      description: "Production-ready image generation for Pink Paisa campaigns.",
      enabled: true,
      coming_soon: false,
      default_model: "gpt-image-1-mini",
      models: [
        {
          id: "gpt-image-1-mini",
          label: "GPT Image 1 Mini",
          supports_reference_image: true,
          supports_text_to_image: true,
          cost_tier: "low",
        },
        {
          id: "gpt-image-1",
          label: "GPT Image 1",
          supports_reference_image: true,
          supports_text_to_image: true,
          cost_tier: "medium",
        },
        {
          id: "gpt-image-2",
          label: "GPT Image 2",
          supports_reference_image: true,
          supports_text_to_image: true,
          cost_tier: "high",
        },
      ],
    },
    {
      key: "google",
      label: "Google",
      description: "Gemini image generation for product-led campaign visuals.",
      enabled: true,
      coming_soon: false,
      default_model: "gemini-2.5-flash-image",
      models: [
        {
          id: "gemini-2.5-flash-image",
          label: "Gemini 2.5 Flash Image",
          supports_reference_image: true,
          supports_text_to_image: true,
          cost_tier: "low",
        },
        {
          id: "gemini-3.1-flash-image-preview",
          label: "Gemini 3.1 Flash Image Preview",
          supports_reference_image: true,
          supports_text_to_image: true,
          cost_tier: "medium",
        },
        {
          id: "gemini-3-pro-image-preview",
          label: "Gemini 3 Pro Image Preview",
          supports_reference_image: true,
          supports_text_to_image: true,
          cost_tier: "high",
        },
      ],
    },
    {
      key: "openrouter",
      label: "OpenRouter",
      description: "Loads the live OpenRouter image-model list from the backend when OPENROUTER_API_KEY is configured.",
      enabled: false,
      coming_soon: true,
      default_model: null,
      models: [],
    },
  ],
  defaults: {
    provider: "openai",
    model: "gpt-image-1-mini",
  },
};

const pad = (value: number) => String(value).padStart(2, "0");

const CampaignAutomationPanel = ({
  settings,
  loading,
  saving,
  imageRegistry,
  onChange,
  onSave,
}: {
  settings: CampaignAutomationSettings;
  loading: boolean;
  saving: boolean;
  imageRegistry: CampaignImageProviderRegistry | null;
  onChange: (patch: Partial<CampaignAutomationSettings>) => void;
  onSave: () => void;
}) => {
  const scheduledTime = `${pad(settings.campaign_batch_hour_ist)}:${pad(settings.campaign_batch_minute_ist)}`;
  const providerOptions = imageRegistry?.providers || [];
  const selectedProvider = providerOptions.find((provider) => provider.key === settings.campaign_ai_provider)
    || providerOptions.find((provider) => provider.enabled)
    || null;
  const modelOptions = selectedProvider?.models || [];
  const selectedModel = modelOptions.find((model) => model.id === settings.campaign_ai_model) || null;

  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Campaign automation</p>
          <h3 className="mt-2 font-serif text-2xl">Manual or automatic posting mode</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Manual mode keeps today&apos;s approval flow. Automatic mode runs the morning batch in IST, approves successful drafts, and publishes them without admin review.
          </p>
        </div>
        <Button className="rounded-2xl" onClick={onSave} disabled={loading || saving}>
          {saving ? "Saving..." : "Save campaign mode"}
        </Button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Mode</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onChange({ campaign_mode: "manual" })}
              className={`rounded-2xl border p-4 text-left transition-all ${
                settings.campaign_mode === "manual"
                  ? "border-primary bg-primary/5"
                  : "border-border/70 bg-background hover:border-border"
              }`}
            >
              <div className="flex items-center gap-2 text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <p className="font-medium">Manual approval</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Generate drafts and stop at review. Admin approves before anything goes live.
              </p>
            </button>

            <button
              type="button"
              onClick={() => onChange({ campaign_mode: "automatic" })}
              className={`rounded-2xl border p-4 text-left transition-all ${
                settings.campaign_mode === "automatic"
                  ? "border-primary bg-primary/5"
                  : "border-border/70 bg-background hover:border-border"
              }`}
            >
              <div className="flex items-center gap-2 text-foreground">
                <Rocket className="h-4 w-4 text-primary" />
                <p className="font-medium">Automatic posting</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Process queued products at the scheduled time and auto-publish successful runs.
              </p>
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <div className="flex items-center gap-2 text-foreground">
            <Clock3 className="h-4 w-4 text-primary" />
            <p className="font-medium">Morning IST schedule</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Automatic mode uses this time for the daily batch trigger. Manual mode ignores it unless you switch modes later.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">Hour</p>
              <Input
                type="number"
                min={0}
                max={23}
                value={settings.campaign_batch_hour_ist}
                onChange={(event) => onChange({ campaign_batch_hour_ist: Number(event.target.value || 0) })}
              />
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">Minute</p>
              <Input
                type="number"
                min={0}
                max={59}
                value={settings.campaign_batch_minute_ist}
                onChange={(event) => onChange({ campaign_batch_minute_ist: Number(event.target.value || 0) })}
              />
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-[#fff8fa] px-4 py-3 text-sm text-[#6b4b57]">
            Next automatic trigger target: <span className="font-medium">{scheduledTime} IST</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr,360px]">
        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <div className="flex items-center gap-2 text-foreground">
            <ImageIcon className="h-4 w-4 text-primary" />
            <p className="font-medium">Creative generation mode</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Template mode uses the current Pink Paisa renderer. AI Generated sends the prompt and product image to the image model and uses the complete raw AI output as the final creative.
          </p>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <button
              type="button"
              onClick={() => onChange({ campaign_creative_mode: "template" })}
              className={`rounded-2xl border p-4 text-left transition-all ${
                settings.campaign_creative_mode === "template"
                  ? "border-primary bg-primary/5"
                  : "border-border/70 bg-background hover:border-border"
              }`}
            >
              <p className="font-medium text-foreground">Template</p>
              <p className="mt-2 text-sm text-muted-foreground">Fastest and cheapest. Uses your current Pink Paisa layout engine.</p>
            </button>

            <button
              type="button"
              onClick={() => onChange({ campaign_creative_mode: "ai_generated" })}
              className={`rounded-2xl border p-4 text-left transition-all ${
                settings.campaign_creative_mode === "ai_generated"
                  ? "border-primary bg-primary/5"
                  : "border-border/70 bg-background hover:border-border"
              }`}
            >
              <div className="flex items-center gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="font-medium">AI Generated</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">Complete AI raw output. Uses the uploaded product image as reference when available and does not apply the in-house overlay renderer.</p>
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <div className="flex items-center gap-2 text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="font-medium">AI provider setup</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the approved provider and model here. This keeps model switching safe and avoids manual typing mistakes.
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">Provider</p>
              <Select
                value={selectedProvider?.key || settings.campaign_ai_provider}
                onValueChange={(value) => {
                  const nextProvider = providerOptions.find((provider) => provider.key === value);
                  onChange({
                    campaign_ai_provider: value,
                    campaign_ai_model: nextProvider?.default_model || nextProvider?.models?.[0]?.id || "",
                  });
                }}
                disabled={!providerOptions.length}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((provider) => (
                    <SelectItem key={provider.key} value={provider.key} disabled={!provider.enabled}>
                      {provider.enabled ? provider.label : `${provider.label} (coming soon)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProvider ? (
                <p className="mt-2 text-xs text-muted-foreground">{selectedProvider.description}</p>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">Model</p>
              <Select
                value={selectedModel?.id || settings.campaign_ai_model}
                onValueChange={(value) => onChange({ campaign_ai_model: value })}
                disabled={!modelOptions.length}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedModel ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Cost tier: <span className="font-medium capitalize text-foreground">{selectedModel.cost_tier}</span>
                </p>
              ) : null}
            </div>

            <div>
              <div className="flex items-center gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="font-medium">Image quality</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Higher quality gives better premium visuals but increases cost and generation time. This setting is used only in AI Generated mode.
              </p>
            </div>

            <div className="grid gap-2">
            {(["low", "medium", "high"] as const).map((quality) => (
              <button
                key={quality}
                type="button"
                onClick={() => onChange({ campaign_ai_image_quality: quality })}
                className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                  settings.campaign_ai_image_quality === quality
                    ? "border-primary bg-primary/5"
                    : "border-border/70 bg-background hover:border-border"
                }`}
              >
                <p className="font-medium capitalize text-foreground">{quality}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {quality === "low" && "Cheapest and fastest, best for testing and high volume."}
                  {quality === "medium" && "Balanced quality for everyday premium campaign generation."}
                  {quality === "high" && "Best creative quality for flagship products and big launches."}
                </p>
              </button>
            ))}
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-[#fff8fa] px-4 py-3 text-sm text-[#6b4b57]">
            The selected provider must have its API key configured on the backend. AI generation is strict now, so failed generation will fail the campaign instead of falling back to template creative.
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border/70 bg-background/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-foreground">
              <MessageSquareQuote className="h-4 w-4 text-primary" />
              <p className="font-medium">Prompt</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              This prompt template is merged with the current product details and used when you regenerate AI creative. In AI Generated mode, the uploaded product image and this prompt go together when a source image exists.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={() => onChange({ campaign_ai_prompt_template: DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE })}
            disabled={loading || saving}
          >
            Reset default prompt
          </Button>
        </div>

        <div className="mt-4">
          <Textarea
            rows={18}
            value={settings.campaign_ai_prompt_template}
            onChange={(event) => onChange({ campaign_ai_prompt_template: event.target.value })}
            placeholder="Use the uploaded image of my product as the base..."
            className="font-mono text-sm leading-6"
          />
        </div>
      </div>
    </div>
  );
};

export default CampaignAutomationPanel;
