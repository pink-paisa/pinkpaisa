import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { ArrowLeft, ExternalLink, ImagePlus, Loader2, ShieldAlert, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { VendorProduct, formatCurrency, formatDate, slugify } from "@/lib/vendor";
import { VendorApiError, VendorApiFieldErrors, uploadVendorImage, vendorFetch } from "@/lib/vendor-api";
import VendorStatusBadge from "@/components/vendor/VendorStatusBadge";
import { useVendorAuth } from "@/contexts/VendorAuthContext";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";
import { cn } from "@/lib/utils";

const emptyForm = {
  title: "",
  slug: "",
  price: "",
  sale_price: "",
  sku: "",
  stock_quantity: "0",
  category_id: "",
  subcategory_id: "",
  short_description: "",
  full_description: "",
  tags: "",
  weight: "",
  dimensions: "",
  status: "active",
  returnable: true,
  return_window_days: "7",
  sort_order: "0",
  featured_image: "",
  additional_images: [] as string[],
};

const MAX_GALLERY_IMAGES = 8;

type ProductFieldKey = keyof typeof emptyForm | "additional_images";

function normalizeFieldErrors(rawValue: unknown): VendorApiFieldErrors {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return {};
  return Object.entries(rawValue as Record<string, unknown>).reduce<VendorApiFieldErrors>((acc, [key, value]) => {
    if (typeof value === "string" && value.trim()) acc[key] = value.trim();
    return acc;
  }, {});
}

const VendorProductDetail = () => {
  const router = useRouter();
  const { vendor, refreshVendor } = useVendorAuth();
  const productId =
    typeof router.query.id === "string" ? router.query.id : Array.isArray(router.query.id) ? router.query.id[0] : "";
  const isCreateMode = !productId || productId === "new";
  const { data: taxonomy } = useProductTaxonomy();
  const [product, setProduct] = useState<VendorProduct | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [featuredUploading, setFeaturedUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [featuredImageUrlDraft, setFeaturedImageUrlDraft] = useState("");
  const [galleryImageUrlDraft, setGalleryImageUrlDraft] = useState("");
  const [fieldErrors, setFieldErrors] = useState<VendorApiFieldErrors>({});
  const [showApprovedEditWarning, setShowApprovedEditWarning] = useState(false);

  const selectedCategory = useMemo(
    () => (taxonomy ?? []).find((item) => item.id === form.category_id),
    [taxonomy, form.category_id]
  );
  const availableSubcategories = selectedCategory?.subcategories ?? [];
  const approvedProductWillGoOffline = !isCreateMode && product?.approval_status === "approved";
  const remainingSlots = vendor?.remaining_slots ?? null;
  const hasReachedSlotLimit = isCreateMode && remainingSlots != null && remainingSlots <= 0;

  const clearFieldError = (key: ProductFieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const clearValidationGroup = (...keys: ProductFieldKey[]) => {
    setFieldErrors((prev) => {
      if (!keys.some((key) => prev[key])) return prev;
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const fieldClassName = (key: ProductFieldKey, base = "h-12 rounded-2xl") =>
    cn(base, fieldErrors[key] ? "border-destructive focus-visible:ring-destructive/30" : undefined);

  const renderFieldError = (key: ProductFieldKey) =>
    fieldErrors[key] ? <p className="mt-2 text-xs text-destructive">{fieldErrors[key]}</p> : null;

  useEffect(() => {
    if (isCreateMode) {
      setLoading(false);
      setProduct(null);
      setForm(emptyForm);
      setFieldErrors({});
      return;
    }

    const load = async () => {
      try {
        const response = await vendorFetch<VendorProduct>(`/vendor-products/mine/${productId}`);
        setProduct(response);
        setForm({
          title: response.title,
          slug: response.slug,
          price: String(response.price ?? ""),
          sale_price: response.sale_price == null ? "" : String(response.sale_price),
          sku: response.sku || "",
          stock_quantity: String(response.stock_quantity ?? 0),
          category_id: response.category_id || "",
          subcategory_id: response.subcategory_id || "",
          short_description: response.short_description || "",
          full_description: response.full_description || "",
          tags: Array.isArray(response.tags) ? response.tags.join(", ") : "",
          weight: response.weight || "",
          dimensions: response.dimensions || "",
          status: response.status || "active",
          returnable: response.returnable !== false,
          return_window_days: String(response.return_window_days ?? 7),
          sort_order: String(response.sort_order ?? 0),
          featured_image: response.featured_image || "",
          additional_images: Array.isArray(response.additional_images) ? response.additional_images : [],
        });
        setFieldErrors({});
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load product");
        void router.replace("/vendor/products");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [isCreateMode, productId, router]);

  const update = (key: keyof typeof emptyForm, value: string | boolean | string[]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === "price" || key === "sale_price") {
      clearValidationGroup("price", "sale_price");
      return;
    }
    if (key === "category_id" || key === "subcategory_id") {
      clearValidationGroup("category_id", "subcategory_id");
      return;
    }
    if (key === "returnable" || key === "return_window_days") {
      clearValidationGroup("return_window_days");
      return;
    }
    clearFieldError(key);
  };

  const validateForm = (): VendorApiFieldErrors => {
    const nextErrors: VendorApiFieldErrors = {};
    const normalizedTitle = form.title.trim();
    const normalizedSlug = slugify(form.slug.trim() || form.title);
    const price = Number(form.price);
    const salePrice = form.sale_price === "" ? null : Number(form.sale_price);
    const stockQuantity = Number(form.stock_quantity);
    const sortOrder = Number(form.sort_order);
    const returnWindowDays = Number(form.return_window_days);

    if (!normalizedTitle) nextErrors.title = "Title is required";
    if (form.slug.trim() && !normalizedSlug) nextErrors.slug = "Slug must include at least one letter or number";
    if (!form.category_id) nextErrors.category_id = "Category is required";
    if (!form.subcategory_id) nextErrors.subcategory_id = "Subcategory is required";
    if (!form.featured_image.trim()) nextErrors.featured_image = "Featured image is required";
    if (Number.isNaN(price) || price <= 0) nextErrors.price = "Price must be greater than 0";
    if (salePrice != null && (Number.isNaN(salePrice) || salePrice < 0)) nextErrors.sale_price = "Sale price must be a valid non-negative number";
    if (salePrice != null && !Number.isNaN(price) && salePrice > price) nextErrors.sale_price = "Sale price cannot exceed price";
    if (Number.isNaN(stockQuantity) || stockQuantity < 0) nextErrors.stock_quantity = "Stock quantity must be a valid non-negative number";
    if (Number.isNaN(sortOrder)) nextErrors.sort_order = "Sort order must be a number";
    if (form.returnable && (Number.isNaN(returnWindowDays) || returnWindowDays < 0)) nextErrors.return_window_days = "Return window must be a valid non-negative number";
    if (form.additional_images.length > MAX_GALLERY_IMAGES) nextErrors.additional_images = `You can add up to ${MAX_GALLERY_IMAGES} gallery images`;

    return nextErrors;
  };

  const syncProductIntoForm = (response: VendorProduct) => {
    setProduct(response);
    setForm((prev) => ({
      ...prev,
      title: response.title,
      slug: response.slug,
      price: String(response.price ?? ""),
      sale_price: response.sale_price == null ? "" : String(response.sale_price),
      sku: response.sku || "",
      stock_quantity: String(response.stock_quantity ?? 0),
      category_id: response.category_id || prev.category_id,
      subcategory_id: response.subcategory_id || prev.subcategory_id,
      short_description: response.short_description || "",
      full_description: response.full_description || "",
      tags: Array.isArray(response.tags) ? response.tags.join(", ") : "",
      weight: response.weight || "",
      dimensions: response.dimensions || "",
      status: response.status || "active",
      returnable: response.returnable !== false,
      return_window_days: String(response.return_window_days ?? 7),
      sort_order: String(response.sort_order ?? 0),
      featured_image: response.featured_image || "",
      additional_images: Array.isArray(response.additional_images) ? response.additional_images : [],
    }));
  };

  const submitProduct = async () => {
    try {
      setSaving(true);
      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim() || slugify(form.title),
        price: Number(form.price),
        sale_price: form.sale_price ? Number(form.sale_price) : null,
        sku: form.sku || null,
        stock_quantity: Number(form.stock_quantity) || 0,
        category_id: form.category_id,
        subcategory_id: form.subcategory_id,
        short_description: form.short_description || null,
        full_description: form.full_description || null,
        tags: form.tags,
        weight: form.weight || null,
        dimensions: form.dimensions || null,
        status: form.status,
        returnable: Boolean(form.returnable),
        return_window_days: Number(form.return_window_days) || 0,
        sort_order: Number(form.sort_order) || 0,
        featured_image: form.featured_image || null,
        additional_images: form.additional_images,
      };
      const response = await vendorFetch<VendorProduct>(isCreateMode ? "/vendor-products" : `/vendor-products/${productId}`, {
        method: isCreateMode ? "POST" : "PUT",
        body: JSON.stringify(payload),
      });
      setFieldErrors({});
      syncProductIntoForm(response);
      await refreshVendor();
      if (isCreateMode) {
        toast.success("Product created and sent for admin review");
        await router.replace(`/vendor/products/${response.id}`);
      } else {
        toast.success(response.approval_status === "pending_approval" ? "Product saved and sent back for admin review" : "Product updated successfully");
      }
    } catch (error) {
      if (error instanceof VendorApiError) {
        const serverFieldErrors = normalizeFieldErrors(error.data.field_errors);
        if (Object.keys(serverFieldErrors).length) {
          setFieldErrors(serverFieldErrors);
        }
        const detailErrors = Array.isArray(error.data.errors)
          ? error.data.errors.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [];
        toast.error(detailErrors[0] || error.message || "Could not save product");
      } else {
        toast.error(error instanceof Error ? error.message : "Could not save product");
      }
    } finally {
      setSaving(false);
      setShowApprovedEditWarning(false);
    }
  };

  const handleFeaturedUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setFeaturedUploading(true);
      const response = await uploadVendorImage(file);
      update("featured_image", response.url);
      clearFieldError("featured_image");
      toast.success("Featured image uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload image");
    } finally {
      setFeaturedUploading(false);
      event.target.value = "";
    }
  };

  const handleGalleryUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const remainingGallerySlots = Math.max(MAX_GALLERY_IMAGES - form.additional_images.length, 0);
    if (remainingGallerySlots <= 0) {
      toast.error(`You can add up to ${MAX_GALLERY_IMAGES} gallery images`);
      event.target.value = "";
      return;
    }

    const filesToUpload = files.slice(0, remainingGallerySlots);
    try {
      setGalleryUploading(true);
      const uploadedUrls: string[] = [];
      for (const file of filesToUpload) {
        try {
          const response = await uploadVendorImage(file);
          uploadedUrls.push(response.url);
        } catch (error) {
          if (uploadedUrls.length) {
            update("additional_images", [...form.additional_images, ...uploadedUrls]);
            clearFieldError("additional_images");
          }
          throw error;
        }
      }
      update("additional_images", [...form.additional_images, ...uploadedUrls]);
      clearFieldError("additional_images");
      if (files.length > filesToUpload.length) {
        toast.error(`Only the first ${remainingGallerySlots} image${remainingGallerySlots === 1 ? "" : "s"} were accepted. Gallery is capped at ${MAX_GALLERY_IMAGES} images.`);
      }
      toast.success(`${uploadedUrls.length} image${uploadedUrls.length > 1 ? "s" : ""} uploaded`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload gallery images");
    } finally {
      setGalleryUploading(false);
      event.target.value = "";
    }
  };

  const addFeaturedImageFromUrl = () => {
    const value = featuredImageUrlDraft.trim();
    if (!value) return;
    update("featured_image", value);
    clearFieldError("featured_image");
    setFeaturedImageUrlDraft("");
  };

  const addGalleryImageFromUrl = () => {
    const value = galleryImageUrlDraft.trim();
    if (!value) return;
    if (form.additional_images.length >= MAX_GALLERY_IMAGES) {
      toast.error(`You can add up to ${MAX_GALLERY_IMAGES} gallery images`);
      return;
    }
    update("additional_images", [...form.additional_images, value]);
    clearFieldError("additional_images");
    setGalleryImageUrlDraft("");
  };

  const removeGalleryImage = (removeIndex: number) => {
    update(
      "additional_images",
      form.additional_images.filter((_, index) => index !== removeIndex)
    );
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (hasReachedSlotLimit) {
      toast.error("You have reached your product upload limit. Contact admin for more slots.");
      return;
    }

    const nextErrors = validateForm();
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] || "Please fix the highlighted fields");
      return;
    }

    if (approvedProductWillGoOffline) {
      setShowApprovedEditWarning(true);
      return;
    }

    await submitProduct();
  };

  const headerTitle = isCreateMode ? "Add one product manually" : "View and edit product";

  if (loading) return <div className="rounded-[30px] border border-white/70 bg-white/85 p-10 text-center text-muted-foreground shadow-sm">Loading product...</div>;

  return (
    <div className="grid gap-6 2xl:grid-cols-[0.76fr,1.24fr]">
      <aside className="space-y-6 rounded-[30px] border border-white/70 bg-white/85 p-6 shadow-sm 2xl:sticky 2xl:top-6 2xl:self-start">
        <button onClick={() => void router.push("/vendor/products")} className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to products</button>

        <section className="rounded-[26px] border border-border/70 bg-secondary/20 p-5">
          <div className="aspect-square overflow-hidden rounded-3xl bg-accent">
            {form.featured_image ? <img src={form.featured_image} alt={form.title || "Featured image"} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted-foreground">No image</div>}
          </div>
          {form.featured_image ? (
            <Button variant="outline" className="mt-5 w-full rounded-2xl" asChild>
              <a href={form.featured_image} target="_blank" rel="noreferrer">Open image <ExternalLink className="ml-2 h-4 w-4" /></a>
            </Button>
          ) : null}
          {form.additional_images.length ? (
            <div className="mt-5 grid grid-cols-3 gap-3">
              {form.additional_images.map((imageUrl, index) => (
                <div key={imageUrl} className="group relative overflow-hidden rounded-2xl border border-border/70 bg-white">
                  <img src={imageUrl} alt="Additional product asset" className="aspect-square h-full w-full object-cover" />
                  <button type="button" onClick={() => removeGalleryImage(index)} className="absolute right-2 top-2 rounded-full bg-black/65 p-1 text-white opacity-0 transition group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="space-y-4 rounded-[26px] border border-border/70 bg-secondary/20 p-5">
          {!isCreateMode ? (
            <>
              <div className="flex flex-wrap gap-2"><VendorStatusBadge status={product?.upload_status || "uploaded"} /><VendorStatusBadge status={product?.approval_status || "pending_approval"} /></div>
              {product?.rejection_reason ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><div className="flex items-start gap-2"><ShieldAlert className="mt-0.5 h-4 w-4" /><div><p className="font-medium">Last rejection reason</p><p className="mt-1">{product.rejection_reason}</p>{product.rejection_note ? <p className="mt-1 text-xs">{product.rejection_note}</p> : null}</div></div></div> : null}
              <div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Created</p><p className="mt-1 font-medium">{formatDate(product?.created_at)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Approved</p><p className="mt-1 font-medium">{formatDate(product?.approved_at)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Price</p><p className="mt-1 font-medium">{formatCurrency(product?.price)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Stock</p><p className="mt-1 font-medium">{product?.stock_quantity}</p></div>
            </>
          ) : (
            <div
              className={cn(
                "rounded-2xl px-4 py-3 text-sm",
                hasReachedSlotLimit
                  ? "border border-rose-200 bg-rose-50 text-rose-700"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-700"
              )}
            >
              {hasReachedSlotLimit
                ? "You have reached your product upload limit. Contact admin before adding more products."
                : `Use this screen when you only want to add one product manually instead of preparing a full CSV import.${remainingSlots != null ? ` You have ${remainingSlots} slot${remainingSlots === 1 ? "" : "s"} remaining.` : ""}`}
            </div>
          )}
          {approvedProductWillGoOffline ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Editing an approved product will take it offline until admin reviews and re-approves it.
            </div>
          ) : null}
          <div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Returnable</p><p className="mt-1 font-medium">{form.returnable ? `Yes | ${form.return_window_days || 0} days` : "No"}</p></div>
          <p className="text-sm text-muted-foreground">Featured and Bestseller are managed only by Admin. Uploaded media is stored on Pink Paisa so campaigns and Instagram publishing do not depend on external vendor URLs.</p>
        </section>
      </aside>

      <form onSubmit={handleSave} className="rounded-[30px] border border-white/70 bg-white/85 p-6 shadow-sm md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Vendor catalog</p>
        <h1 className="mt-2 font-serif text-3xl">{headerTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Primary flow uses direct uploads. URL import is still available as a fallback for advanced users, but the server ingests and hosts those images before review.</p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2"><label className="mb-2 block text-sm font-medium">Title</label><Input value={form.title} onChange={(e) => update("title", e.target.value)} className={fieldClassName("title")} />{renderFieldError("title")}</div>
          <div><label className="mb-2 block text-sm font-medium">Slug</label><Input value={form.slug} onChange={(e) => update("slug", e.target.value)} className={fieldClassName("slug")} placeholder="Leave blank to generate from title" />{renderFieldError("slug")}</div>
          <div><label className="mb-2 block text-sm font-medium">SKU</label><Input value={form.sku} onChange={(e) => update("sku", e.target.value)} className={fieldClassName("sku")} />{renderFieldError("sku")}</div>
          <div><label className="mb-2 block text-sm font-medium">Price</label><Input type="number" value={form.price} onChange={(e) => update("price", e.target.value)} className={fieldClassName("price")} />{renderFieldError("price")}</div>
          <div><label className="mb-2 block text-sm font-medium">Sale Price</label><Input type="number" value={form.sale_price} onChange={(e) => update("sale_price", e.target.value)} className={fieldClassName("sale_price")} />{renderFieldError("sale_price")}</div>
          <div><label className="mb-2 block text-sm font-medium">Stock Quantity</label><Input type="number" value={form.stock_quantity} onChange={(e) => update("stock_quantity", e.target.value)} className={fieldClassName("stock_quantity")} />{renderFieldError("stock_quantity")}</div>
          <div><label className="mb-2 block text-sm font-medium">Category</label><Select value={form.category_id} onValueChange={(value) => { setForm((prev) => ({ ...prev, category_id: value, subcategory_id: "" })); clearValidationGroup("category_id", "subcategory_id"); }}><SelectTrigger className={fieldClassName("category_id")}><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{(taxonomy ?? []).filter((item) => item.slug !== "uncategorized").map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select>{renderFieldError("category_id")}</div>
          <div><label className="mb-2 block text-sm font-medium">Subcategory</label><Select value={form.subcategory_id} onValueChange={(value) => update("subcategory_id", value)} disabled={!form.category_id}><SelectTrigger className={fieldClassName("subcategory_id")}><SelectValue placeholder="Select subcategory" /></SelectTrigger><SelectContent>{availableSubcategories.map((subcategory) => <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}</SelectItem>)}</SelectContent></Select>{renderFieldError("subcategory_id")}</div>
          <div><label className="mb-2 block text-sm font-medium">Weight</label><Input value={form.weight} onChange={(e) => update("weight", e.target.value)} className={fieldClassName("weight")} /></div>
          <div><label className="mb-2 block text-sm font-medium">Dimensions</label><Input value={form.dimensions} onChange={(e) => update("dimensions", e.target.value)} className={fieldClassName("dimensions")} /></div>
          <div><label className="mb-2 block text-sm font-medium">Sort Order</label><Input type="number" value={form.sort_order} onChange={(e) => update("sort_order", e.target.value)} className={fieldClassName("sort_order")} />{renderFieldError("sort_order")}</div>
          <div><label className="mb-2 block text-sm font-medium">Inventory Status</label><select value={form.status} onChange={(e) => update("status", e.target.value)} className={cn("h-12 w-full rounded-2xl border border-border bg-white px-3 text-sm", fieldErrors.status ? "border-destructive" : undefined)}><option value="active">Active</option><option value="draft">Draft</option><option value="inactive">Inactive</option></select></div>
          <div><label className="mb-2 block text-sm font-medium">Returnable</label><select value={form.returnable ? "yes" : "no"} onChange={(e) => update("returnable", e.target.value === "yes")} className="h-12 w-full rounded-2xl border border-border bg-white px-3 text-sm"><option value="yes">Yes</option><option value="no">No</option></select></div>
          <div><label className="mb-2 block text-sm font-medium">Return Window (days)</label><Input type="number" min="0" value={form.return_window_days} onChange={(e) => update("return_window_days", e.target.value)} className={fieldClassName("return_window_days")} disabled={!form.returnable} />{renderFieldError("return_window_days")}</div>
          <div className="md:col-span-2"><label className="mb-2 block text-sm font-medium">Short Description</label><Textarea value={form.short_description} onChange={(e) => update("short_description", e.target.value)} className="min-h-[90px] rounded-2xl" /></div>
          <div className="md:col-span-2"><label className="mb-2 block text-sm font-medium">Full Description</label><Textarea value={form.full_description} onChange={(e) => update("full_description", e.target.value)} className="min-h-[150px] rounded-2xl" /></div>
          <div className="md:col-span-2"><label className="mb-2 block text-sm font-medium">Tags</label><Input value={form.tags} onChange={(e) => update("tags", e.target.value)} className="h-12 rounded-2xl" placeholder="sleep, women wellness, hormone care" /></div>
        </div>

        <section className="mt-8 rounded-[26px] border border-border/70 bg-secondary/20 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">Product media</p>
              <h2 className="mt-1 font-serif text-2xl">Upload stable marketplace assets</h2>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">The featured image is required. Gallery images are optional and will also be hosted on Pink Paisa after save.</p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-white p-4">
              <label className="mb-2 block text-sm font-medium">Featured image upload <span className="text-destructive">*</span></label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
                {featuredUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {featuredUploading ? "Uploading featured image..." : "Upload featured image"}
                <input type="file" accept="image/*" className="hidden" onChange={handleFeaturedUpload} />
              </label>
              <div className="mt-4 flex gap-2">
                <Input value={featuredImageUrlDraft} onChange={(e) => setFeaturedImageUrlDraft(e.target.value)} className={fieldClassName("featured_image", "h-11 rounded-2xl")} placeholder="Advanced: paste image URL" />
                <Button type="button" variant="outline" className="rounded-2xl" onClick={addFeaturedImageFromUrl}><ImagePlus className="mr-2 h-4 w-4" /> Use URL</Button>
              </div>
              {renderFieldError("featured_image")}
            </div>

            <div className="rounded-2xl border border-border/70 bg-white p-4">
              <label className="mb-2 block text-sm font-medium">Gallery images</label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
                {galleryUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                {galleryUploading ? "Uploading gallery..." : `Upload gallery images (${form.additional_images.length}/${MAX_GALLERY_IMAGES})`}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryUpload} />
              </label>
              <div className="mt-4 flex gap-2">
                <Input value={galleryImageUrlDraft} onChange={(e) => setGalleryImageUrlDraft(e.target.value)} className={fieldClassName("additional_images", "h-11 rounded-2xl")} placeholder="Advanced: paste one gallery image URL" />
                <Button type="button" variant="outline" className="rounded-2xl" onClick={addGalleryImageFromUrl}><ImagePlus className="mr-2 h-4 w-4" /> Add URL</Button>
              </div>
              {renderFieldError("additional_images")}
            </div>
          </div>
        </section>

        <div className="mt-8 flex justify-end gap-3">
          <Button type="button" variant="outline" className="rounded-2xl" onClick={() => void router.push("/vendor/products")}>Cancel</Button>
          <Button type="submit" className="rounded-2xl" disabled={saving || featuredUploading || galleryUploading || hasReachedSlotLimit}>{saving ? "Saving..." : isCreateMode ? "Create product" : "Save changes"}</Button>
        </div>
      </form>

      <ConfirmActionDialog
        open={showApprovedEditWarning}
        onOpenChange={setShowApprovedEditWarning}
        title="Take this product offline for re-approval?"
        description="Saving changes to an approved product will immediately remove it from the live storefront and send it back to pending approval until admin reviews it again."
        confirmLabel="Save and send for review"
        onConfirm={submitProduct}
        pending={saving}
      />
    </div>
  );
};

export default VendorProductDetail;
