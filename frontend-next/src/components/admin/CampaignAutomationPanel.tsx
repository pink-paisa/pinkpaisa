import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Clock3, MessageSquareQuote, Rocket, ShieldCheck, Sparkles } from "lucide-react";

export type CampaignAutomationSettings = {
  campaign_mode: "manual" | "automatic";
  campaign_batch_hour_ist: number;
  campaign_batch_minute_ist: number;
  campaign_creative_mode: "template" | "ai_generated";
  campaign_ai_provider: string;
  campaign_ai_model: string;
  campaign_ai_image_quality: "low" | "medium" | "high";
  campaign_ai_prompt_template: string;
  campaign_ai_affiliate_prompt_template: string;
  campaign_ai_catalog_prompt_template: string;
  prompt_defaults: {
    affiliate: string;
    catalog: string;
  };
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
      default_model: "gpt-image-2",
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
          id: "gpt-image-1.5",
          label: "GPT Image 1.5",
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
    model: "gpt-image-2",
  },
};

const pad = (value: number) => String(value).padStart(2, "0");

const CampaignAutomationPanel = ({
  settings,
  loading,
  saving,
  imageRegistry,
  imageRegistryError,
  onChange,
  onSave,
}: {
  settings: CampaignAutomationSettings;
  loading: boolean;
  saving: boolean;
  imageRegistry: CampaignImageProviderRegistry | null;
  imageRegistryError?: string | null;
  onChange: (patch: Partial<CampaignAutomationSettings>) => void;
  onSave: () => void;
}) => {
  const [activePrompt, setActivePrompt] = useState<"affiliate" | "catalog">("affiliate");
  const scheduledTime = `${pad(settings.campaign_batch_hour_ist)}:${pad(settings.campaign_batch_minute_ist)}`;
  const providerOptions = (imageRegistry?.providers || [])
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) => model.supports_reference_image),
    }))
    .filter((provider) => provider.enabled && provider.models.length > 0);
  const selectedProvider = providerOptions.find((provider) => provider.key === settings.campaign_ai_provider) || null;
  const modelOptions = (selectedProvider?.models || []).filter((model) => model.supports_reference_image);
  const selectedModel = modelOptions.find((model) => model.id === settings.campaign_ai_model) || null;
  const promptField = activePrompt === "affiliate"
    ? "campaign_ai_affiliate_prompt_template"
    : "campaign_ai_catalog_prompt_template";
  const promptDefaults = settings.prompt_defaults || { affiliate: "", catalog: "" };
  const defaultPrompt = promptDefaults[activePrompt] || "";
  const promptValue = settings[promptField]
    || (activePrompt === "affiliate" ? settings.campaign_ai_prompt_template : "")
    || "";
  const registryReadOnly = Boolean(imageRegistryError);

  return (
    <div className="rounded-3xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Campaign automation</p>
          <h3 className="mt-2 font-serif text-2xl">Manual or automatic draft generation</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Both modes stop every generated image and caption for admin review. Automatic mode only starts the scheduled draft pipeline; it never publishes by itself.
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
                <p className="font-medium">Manual draft generation</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Start batches yourself. Every completed draft waits for visual review and approval.
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
                <p className="font-medium">Automatic draft generation</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Start queued products at the scheduled time, then stop every result at mandatory review.
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
            Automatic draft mode uses this time for the daily batch trigger. Manual mode ignores it until you switch modes.
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
            Next draft trigger target: <span className="font-medium">{scheduledTime} IST</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
          <div className="flex items-center gap-2 text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="font-medium">AI provider setup</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Only models that accept a required product reference image are available.
          </p>
          {imageRegistryError ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{imageRegistryError} Your saved provider and model are preserved and read-only until the registry loads again.</p>
            </div>
          ) : null}

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
                disabled={registryReadOnly || !providerOptions.length}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {!selectedProvider && settings.campaign_ai_provider ? (
                    <SelectItem value={settings.campaign_ai_provider} disabled>
                      {settings.campaign_ai_provider} (saved, unavailable)
                    </SelectItem>
                  ) : null}
                  {providerOptions.map((provider) => (
                    <SelectItem key={provider.key} value={provider.key}>
                      {provider.label}
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
                disabled={registryReadOnly || !modelOptions.length}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {!selectedModel && settings.campaign_ai_model ? (
                    <SelectItem value={settings.campaign_ai_model} disabled>
                      {settings.campaign_ai_model} (saved, unavailable)
                    </SelectItem>
                  ) : null}
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
                Higher quality can improve the final reference edit but increases cost and generation time.
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
            The product image is mandatory. A missing, invalid, or unreachable reference fails before the image model is called, and there is no generic fallback.
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border/70 bg-background/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-foreground">
              <MessageSquareQuote className="h-4 w-4 text-primary" />
              <p className="font-medium">Creative direction</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              This direction is merged with verified product details and the mandatory product image. Identity-preservation and prohibited-content rules are always added by the server.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={() => onChange({ [promptField]: defaultPrompt })}
            disabled={loading || saving || !defaultPrompt}
          >
            Reset {activePrompt} prompt
          </Button>
        </div>

        <div className="mt-4">
          <Tabs value={activePrompt} onValueChange={(value) => setActivePrompt(value as "affiliate" | "catalog")}>
            <TabsList className="grid w-full max-w-sm grid-cols-2">
              <TabsTrigger value="affiliate">Affiliate</TabsTrigger>
              <TabsTrigger value="catalog">Catalog</TabsTrigger>
            </TabsList>
          </Tabs>
          <Textarea
            rows={18}
            value={promptValue}
            onChange={(event) => onChange({ [promptField]: event.target.value })}
            placeholder="Describe the background, lighting, mood, and restrained props..."
            className="mt-3 font-mono text-sm leading-6"
          />
        </div>
      </div>
    </div>
  );
};

export default CampaignAutomationPanel;
