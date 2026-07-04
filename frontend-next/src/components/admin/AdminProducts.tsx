/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Pencil, Trash2, Eye, EyeOff, Store, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ImageUpload from "@/components/ImageUpload";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import { ApiError, apiFetch } from "@/lib/api";
import { useProducts, type Product } from "@/hooks/useProducts";
import { usePhysicalProducts, type PhysicalProduct } from "@/hooks/usePhysicalProducts";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";
import AdminProductTaxonomyManager from "./AdminProductTaxonomyManager";
import {
  StatCard,
  StatusBadge,
  LoadingSpinner,
  EmptyState,
  Field,
  FormCard,
  IconBtn,
  CheckboxField,
  formatPrice,
  PRODUCT_STATUSES,
  ICON_OPTIONS,
} from "./AdminShared";

type ProductForm = {
  title: string;
  slug: string;
  subtitle: string;
  description: string;
  icon: string;
  badge: string;
  badge_color: string;
  price: string;
  price_max: string;
  format: string;
  includes: string;
  status: string;
  is_active: boolean;
  sort_order: string;
};

const emptyProductForm: ProductForm = {
  title: "",
  slug: "",
  subtitle: "",
  description: "",
  icon: "Sparkles",
  badge: "",
  badge_color: "bg-accent text-accent-foreground",
  price: "",
  price_max: "",
  format: "",
  includes: "",
  status: "active",
  is_active: true,
  sort_order: "0",
};

type PhysicalForm = {
  title: string;
  slug: string;
  short_description: string;
  full_description: string;
  category_id: string;
  subcategory_id: string;
  featured_image: string;
  images: string[];
  price: string;
  sale_price: string;
  gst_rate_percent: string;
  hsn_code: string;
  brand_name: string;
  country_of_origin: string;
  sku: string;
  stock_quantity: string;
  tags: string;
  seo_meta_title: string;
  seo_meta_description: string;
  seo_keywords: string;
  attributes_json: string;
  weight: string;
  dimensions: string;
  status: string;
  returnable: boolean;
  return_window_days: string;
  return_liability: "vendor" | "pinkpaisa";
  featured: boolean;
  bestseller: boolean;
  sort_order: string;
};

const emptyPhysicalForm: PhysicalForm = {
  title: "",
  slug: "",
  short_description: "",
  full_description: "",
  category_id: "",
  subcategory_id: "",
  featured_image: "",
  images: [],
  price: "",
  sale_price: "",
  gst_rate_percent: "0",
  hsn_code: "",
  brand_name: "",
  country_of_origin: "India",
  sku: "",
  stock_quantity: "0",
  tags: "",
  seo_meta_title: "",
  seo_meta_description: "",
  seo_keywords: "",
  attributes_json: "",
  weight: "",
  dimensions: "",
  status: "active",
  returnable: true,
  return_window_days: "7",
  return_liability: "vendor",
  featured: false,
  bestseller: false,
  sort_order: "0",
};

type SubTab = "physical" | "virtual";

export const AdminProducts = () => {
  const [subTab, setSubTab] = useState<SubTab>("physical");
  const queryClient = useQueryClient();

  const { data: products, isLoading: productsLoading } = useProducts(true);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>(emptyProductForm);
  const [savingProduct, setSavingProduct] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [virtualProductToDelete, setVirtualProductToDelete] = useState<Product | null>(null);

  const { data: physicalProducts, isLoading: physicalLoading } = usePhysicalProducts(true, "admin", false);
  const [showPhysicalForm, setShowPhysicalForm] = useState(false);
  const [editingPhysicalId, setEditingPhysicalId] = useState<string | null>(null);
  const [physicalForm, setPhysicalForm] = useState<PhysicalForm>(emptyPhysicalForm);
  const [physicalErrors, setPhysicalErrors] = useState<Record<string, string>>({});
  const [savingPhysical, setSavingPhysical] = useState(false);
  const [physicalSearch, setPhysicalSearch] = useState("");
  const [physicalProductToDelete, setPhysicalProductToDelete] = useState<PhysicalProduct | null>(null);

  const { data: taxonomy } = useProductTaxonomy({ includeInactive: true, includeUncategorized: true });
  const activePhysicalCategory = useMemo(
    () => (taxonomy ?? []).find((category) => category.id === physicalForm.category_id),
    [taxonomy, physicalForm.category_id]
  );
  const activePhysicalSubcategories = activePhysicalCategory?.subcategories ?? [];

  const clearPhysicalErrors = (...keys: string[]) => {
    setPhysicalErrors((prev) => {
      if (!keys.some((key) => prev[key])) return prev;
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const updatePhysicalField = <K extends keyof PhysicalForm>(key: K, value: PhysicalForm[K], errorKeys?: string[]) => {
    setPhysicalForm((prev) => ({ ...prev, [key]: value }));
    clearPhysicalErrors(...(errorKeys ?? [String(key)]));
  };

  const fieldClassName = (key: string) =>
    physicalErrors[key] ? "border-destructive focus-visible:ring-destructive/30" : "";

  const saveProduct = async () => {
    if (!productForm.title || !productForm.slug || !productForm.price) {
      toast.error("Title, slug, price required");
      return;
    }
    setSavingProduct(true);
    const payload = {
      title: productForm.title,
      slug: productForm.slug,
      subtitle: productForm.subtitle || null,
      description: productForm.description || null,
      icon: productForm.icon,
      badge: productForm.badge || null,
      badge_color: productForm.badge_color || null,
      price: Number(productForm.price),
      price_max: productForm.price_max ? Number(productForm.price_max) : null,
      format: productForm.format || null,
      includes: productForm.includes ? productForm.includes.split("\n").filter(Boolean) : [],
      status: productForm.status,
      is_active: productForm.status === "active",
      sort_order: Number(productForm.sort_order) || 0,
    };

    try {
      if (editingProductId) {
        await apiFetch(`/virtual-products/${editingProductId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch(`/virtual-products`, { method: "POST", body: JSON.stringify(payload) });
      }
      toast.success(editingProductId ? "Updated" : "Added");
      setShowProductForm(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
      console.error(error);
    }
    setSavingProduct(false);
  };

  const deleteProduct = async () => {
    if (!virtualProductToDelete) return;
    try {
      await apiFetch(`/virtual-products/${virtualProductToDelete.id}`, { method: "DELETE" });
      toast.success("Deleted");
      setVirtualProductToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
      console.error(error);
    }
  };

  const toggleProductStatus = async (product: Product) => {
    const status = (product as any).status === "active" ? "draft" : "active";
    try {
      await apiFetch(`/virtual-products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({ status, is_active: status === "active" }),
      });
      toast.success(status === "active" ? "Activated" : "Drafted");
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
      console.error(error);
    }
  };

  const openEditProduct = (product: Product) => {
    setEditingProductId(product.id);
    setProductForm({
      title: product.title,
      slug: product.slug,
      subtitle: product.subtitle ?? "",
      description: product.description ?? "",
      icon: product.icon,
      badge: product.badge ?? "",
      badge_color: product.badge_color ?? "bg-accent text-accent-foreground",
      price: String(product.price),
      price_max: product.price_max ? String(product.price_max) : "",
      format: product.format ?? "",
      includes: Array.isArray(product.includes) ? product.includes.join("\n") : "",
      status: (product as any).status ?? "active",
      is_active: product.is_active,
      sort_order: String(product.sort_order),
    });
    setShowProductForm(true);
  };

  const savePhysical = async () => {
    const nextFieldErrors: Record<string, string> = {};
    if (!physicalForm.title) nextFieldErrors.title = "Title is required";
    if (!physicalForm.slug) nextFieldErrors.slug = "Slug is required";
    if (!physicalForm.price) nextFieldErrors.price = "Price is required";
    if (!physicalForm.category_id) nextFieldErrors.category_id = "Category is required";
    if (!physicalForm.subcategory_id) nextFieldErrors.subcategory_id = "Subcategory is required";
    if (!physicalForm.featured_image) nextFieldErrors.featured_image = "Featured image is required";

    let parsedAttributes: Record<string, unknown> = {};
    if (physicalForm.attributes_json.trim()) {
      try {
        const parsed = JSON.parse(physicalForm.attributes_json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          nextFieldErrors.attributes = "Attributes must be a JSON object";
        } else {
          parsedAttributes = parsed as Record<string, unknown>;
        }
      } catch {
        nextFieldErrors.attributes = "Attributes must be valid JSON";
      }
    }

    if (Object.keys(nextFieldErrors).length) {
      setPhysicalErrors(nextFieldErrors);
      toast.error("Please fix the highlighted product fields.");
      return;
    }

    setSavingPhysical(true);
    const payload = {
      title: physicalForm.title,
      slug: physicalForm.slug,
      short_description: physicalForm.short_description || null,
      full_description: physicalForm.full_description || null,
      category_id: physicalForm.category_id,
      subcategory_id: physicalForm.subcategory_id,
      featured_image: physicalForm.featured_image || null,
      images: physicalForm.images,
      price: Number(physicalForm.price),
      sale_price: physicalForm.sale_price ? Number(physicalForm.sale_price) : null,
      gst_rate_percent: physicalForm.gst_rate_percent ? Number(physicalForm.gst_rate_percent) : 0,
      hsn_code: physicalForm.hsn_code || null,
      brand_name: physicalForm.brand_name || null,
      country_of_origin: physicalForm.country_of_origin || "India",
      sku: physicalForm.sku || null,
      stock_quantity: Number(physicalForm.stock_quantity) || 0,
      tags: physicalForm.tags ? physicalForm.tags.split(",").map((entry) => entry.trim()).filter(Boolean) : [],
      seo_meta_title: physicalForm.seo_meta_title || null,
      seo_meta_description: physicalForm.seo_meta_description || null,
      seo_keywords: physicalForm.seo_keywords
        ? physicalForm.seo_keywords.split(",").map((entry) => entry.trim()).filter(Boolean)
        : [],
      attributes: parsedAttributes,
      weight: physicalForm.weight ? Number(physicalForm.weight) : null,
      dimensions: physicalForm.dimensions || null,
      status: physicalForm.status === "out_of_stock" ? "inactive" : physicalForm.status,
      returnable: physicalForm.returnable,
      return_window_days: Number(physicalForm.return_window_days) || 0,
      return_liability: physicalForm.return_liability,
      featured: physicalForm.featured,
      bestseller: physicalForm.bestseller,
      sort_order: Number(physicalForm.sort_order) || 0,
      is_visible: true,
    };

    try {
      const saved = editingPhysicalId
        ? await apiFetch<PhysicalProduct>(`/products/${editingPhysicalId}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiFetch<PhysicalProduct>(`/products`, { method: "POST", body: JSON.stringify(payload) });
      const slugSuffix = saved.slug !== physicalForm.slug ? ` Saved as ${saved.slug}.` : "";
      toast.success(`${editingPhysicalId ? "Updated" : "Added"} product.${slugSuffix}`);
      setPhysicalErrors({});
      setShowPhysicalForm(false);
      queryClient.invalidateQueries({ queryKey: ["physical_products"] });
      queryClient.invalidateQueries({ queryKey: ["catalog_products"] });
    } catch (error) {
      if (error instanceof ApiError && error.field_errors) {
        setPhysicalErrors(error.field_errors);
        toast.error("Please fix the highlighted product fields.");
      } else {
        toast.error(error instanceof Error ? error.message : "Failed");
      }
      console.error(error);
    }
    setSavingPhysical(false);
  };

  const deletePhysical = async () => {
    if (!physicalProductToDelete) return;
    await apiFetch(`/products/${physicalProductToDelete.id}`, { method: "DELETE" });
    toast.success("Deleted");
    setPhysicalProductToDelete(null);
    queryClient.invalidateQueries({ queryKey: ["physical_products"] });
    queryClient.invalidateQueries({ queryKey: ["catalog_products"] });
  };

  const openEditPhysical = (product: PhysicalProduct) => {
    setEditingPhysicalId(product.id);
    setPhysicalErrors({});
    setPhysicalForm({
      title: product.title,
      slug: product.slug,
      short_description: product.short_description ?? "",
      full_description: product.full_description ?? "",
      category_id: product.category_id ?? "",
      subcategory_id: product.subcategory_id ?? "",
      featured_image: product.featured_image ?? "",
      images: Array.isArray(product.images)
        ? (product.images as string[]).filter((url) => url && url !== (product.featured_image ?? ""))
        : [],
      price: String(product.price),
      sale_price: product.sale_price ? String(product.sale_price) : "",
      gst_rate_percent: String(product.gst_rate_percent ?? 0),
      hsn_code: product.hsn_code ?? "",
      brand_name: product.brand_name ?? "",
      country_of_origin: product.country_of_origin ?? "India",
      sku: product.sku ?? "",
      stock_quantity: String(product.stock_quantity),
      tags: (product.tags ?? []).join(", "),
      seo_meta_title: product.seo_meta_title ?? "",
      seo_meta_description: product.seo_meta_description ?? "",
      seo_keywords: (product.seo_keywords ?? []).join(", "),
      attributes_json: product.attributes && Object.keys(product.attributes).length ? JSON.stringify(product.attributes, null, 2) : "",
      weight: product.weight ? String(product.weight) : "",
      dimensions: product.dimensions ?? "",
      status: product.status,
      returnable: product.returnable !== false,
      return_window_days: String(product.return_window_days ?? 7),
      return_liability: product.return_liability === "pinkpaisa" ? "pinkpaisa" : "vendor",
      featured: product.featured,
      bestseller: product.bestseller,
      sort_order: String(product.sort_order),
    });
    setShowPhysicalForm(true);
  };

  const filteredProducts = (products ?? []).filter(
    (product) => !productSearch || product.title.toLowerCase().includes(productSearch.toLowerCase())
  );
  const filteredPhysical = (physicalProducts ?? []).filter(
    (product) => !physicalSearch || product.title.toLowerCase().includes(physicalSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-2xl mb-1">Upload Products</h2>
        <p className="text-sm text-muted-foreground">Manage your physical and virtual product inventory.</p>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setSubTab("physical")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${subTab === "physical" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Store className="h-3.5 w-3.5" /> Physical Products
        </button>
        <button
          onClick={() => setSubTab("virtual")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${subTab === "virtual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <ShoppingBag className="h-3.5 w-3.5" /> Virtual Programs
        </button>
      </div>

      {subTab === "physical" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total" value={(physicalProducts ?? []).length} />
            <StatCard label="Active" value={(physicalProducts ?? []).filter((product) => product.status === "active").length} color="text-emerald-600" />
            <StatCard label="Low Stock" value={(physicalProducts ?? []).filter((product) => product.stock_quantity <= 5 && product.stock_quantity > 0).length} color="text-amber-600" />
            <StatCard label="Out of Stock" value={(physicalProducts ?? []).filter((product) => product.stock_quantity === 0).length} color="text-red-600" />
          </div>

          <AdminProductTaxonomyManager />

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search products..." value={physicalSearch} onChange={(e) => setPhysicalSearch(e.target.value)} className="pl-9" />
            </div>
            <Button
              onClick={() => {
                setEditingPhysicalId(null);
                setPhysicalErrors({});
                setPhysicalForm(emptyPhysicalForm);
                setShowPhysicalForm(true);
              }}
              className="rounded-xl"
            >
              <Plus className="h-4 w-4" /> Add Product
            </Button>
          </div>

          {showPhysicalForm && (
            <FormCard
              title={editingPhysicalId ? "Edit Product" : "Add Product"}
              onClose={() => {
                setShowPhysicalForm(false);
                setPhysicalErrors({});
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Product Name *" error={physicalErrors.title}>
                  <Input value={physicalForm.title} onChange={(e) => updatePhysicalField("title", e.target.value)} className={fieldClassName("title")} />
                </Field>
                <Field label="Slug *" error={physicalErrors.slug}>
                  <Input value={physicalForm.slug} onChange={(e) => updatePhysicalField("slug", e.target.value)} className={fieldClassName("slug")} />
                </Field>
                <Field label="Price *" error={physicalErrors.price}>
                  <Input type="number" min="0" value={physicalForm.price} onChange={(e) => updatePhysicalField("price", e.target.value)} className={fieldClassName("price")} />
                </Field>
                <Field label="Sale Price" error={physicalErrors.sale_price}>
                  <Input type="number" min="0" value={physicalForm.sale_price} onChange={(e) => updatePhysicalField("sale_price", e.target.value)} className={fieldClassName("sale_price")} />
                </Field>
                <Field label="Category *" error={physicalErrors.category_id}>
                  <Select
                    value={physicalForm.category_id}
                    onValueChange={(value) => {
                      setPhysicalForm((prev) => ({ ...prev, category_id: value, subcategory_id: "" }));
                      clearPhysicalErrors("category_id", "subcategory_id");
                    }}
                  >
                    <SelectTrigger className={fieldClassName("category_id")}><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {(taxonomy ?? []).filter((category) => category.slug !== "uncategorized").map((category) => (
                        <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Subcategory *" error={physicalErrors.subcategory_id}>
                  <Select value={physicalForm.subcategory_id} onValueChange={(value) => updatePhysicalField("subcategory_id", value)} disabled={!physicalForm.category_id}>
                    <SelectTrigger className={fieldClassName("subcategory_id")}><SelectValue placeholder="Select subcategory" /></SelectTrigger>
                    <SelectContent>
                      {activePhysicalSubcategories.map((subcategory) => (
                        <SelectItem key={subcategory.id} value={subcategory.id}>{subcategory.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={physicalForm.status} onValueChange={(value) => updatePhysicalField("status", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRODUCT_STATUSES.map((status) => (
                        <SelectItem key={status} value={status} className="capitalize">{status.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Stock Quantity" error={physicalErrors.stock_quantity}>
                  <Input type="number" min="0" value={physicalForm.stock_quantity} onChange={(e) => updatePhysicalField("stock_quantity", e.target.value)} className={fieldClassName("stock_quantity")} />
                </Field>
                <Field label="SKU" error={physicalErrors.sku}>
                  <Input value={physicalForm.sku} onChange={(e) => updatePhysicalField("sku", e.target.value)} className={fieldClassName("sku")} />
                </Field>
                <Field label="Brand">
                  <Input value={physicalForm.brand_name} onChange={(e) => updatePhysicalField("brand_name", e.target.value)} />
                </Field>
                <Field label="Country of Origin">
                  <Input value={physicalForm.country_of_origin} onChange={(e) => updatePhysicalField("country_of_origin", e.target.value)} />
                </Field>
                <Field label="GST Rate (%)" error={physicalErrors.gst_rate_percent}>
                  <Input type="number" min="0" max="50" value={physicalForm.gst_rate_percent} onChange={(e) => updatePhysicalField("gst_rate_percent", e.target.value)} className={fieldClassName("gst_rate_percent")} />
                </Field>
                <Field label="HSN Code">
                  <Input value={physicalForm.hsn_code} onChange={(e) => updatePhysicalField("hsn_code", e.target.value)} />
                </Field>
                <Field label="Weight (g)" error={physicalErrors.weight}>
                  <Input type="number" min="0" value={physicalForm.weight} onChange={(e) => updatePhysicalField("weight", e.target.value)} className={fieldClassName("weight")} />
                </Field>
                <Field label="Dimensions">
                  <Input value={physicalForm.dimensions} onChange={(e) => updatePhysicalField("dimensions", e.target.value)} placeholder="L x W x H" />
                </Field>
                <Field label="Sort Order" error={physicalErrors.sort_order}>
                  <Input type="number" min="0" value={physicalForm.sort_order} onChange={(e) => updatePhysicalField("sort_order", e.target.value)} className={fieldClassName("sort_order")} />
                </Field>
              </div>

              <div className="flex flex-wrap gap-4">
                <CheckboxField label="Featured" checked={physicalForm.featured} onChange={(value) => updatePhysicalField("featured", value)} />
                <CheckboxField label="Bestseller" checked={physicalForm.bestseller} onChange={(value) => updatePhysicalField("bestseller", value)} />
                <CheckboxField label="Returnable" checked={physicalForm.returnable} onChange={(value) => updatePhysicalField("returnable", value, ["returnable", "return_window_days"])} />
              </div>

              <Field label="Short Description">
                <Textarea value={physicalForm.short_description} onChange={(e) => updatePhysicalField("short_description", e.target.value)} rows={2} />
              </Field>

              <Field label="Full Description">
                <Textarea value={physicalForm.full_description} onChange={(e) => updatePhysicalField("full_description", e.target.value)} rows={4} />
              </Field>

              <Field label="Tags (comma-separated)">
                <Input value={physicalForm.tags} onChange={(e) => updatePhysicalField("tags", e.target.value)} />
              </Field>

              <ImageUpload
                value={physicalForm.featured_image}
                onChange={(url) => updatePhysicalField("featured_image", url)}
                additionalImages={physicalForm.images}
                onAdditionalChange={(urls) => {
                  setPhysicalForm((prev) => ({ ...prev, images: urls }));
                  clearPhysicalErrors("images");
                }}
                bucket="product-images"
                folder="physical"
                error={physicalErrors.featured_image}
                additionalError={physicalErrors.images}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Return Window (days)" error={physicalErrors.return_window_days}>
                  <Input type="number" min="0" value={physicalForm.return_window_days} onChange={(e) => updatePhysicalField("return_window_days", e.target.value)} className={fieldClassName("return_window_days")} disabled={!physicalForm.returnable} />
                </Field>
                <Field label="Return Liability">
                  <Select value={physicalForm.return_liability} onValueChange={(value: "vendor" | "pinkpaisa") => updatePhysicalField("return_liability", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vendor">Vendor</SelectItem>
                      <SelectItem value="pinkpaisa">Pink Paisa</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="SEO Title">
                  <Input value={physicalForm.seo_meta_title} onChange={(e) => updatePhysicalField("seo_meta_title", e.target.value)} />
                </Field>
                <Field label="SEO Keywords (comma-separated)">
                  <Input value={physicalForm.seo_keywords} onChange={(e) => updatePhysicalField("seo_keywords", e.target.value)} />
                </Field>
              </div>

              <Field label="SEO Description">
                <Textarea value={physicalForm.seo_meta_description} onChange={(e) => updatePhysicalField("seo_meta_description", e.target.value)} rows={2} />
              </Field>

              <Field label="Attributes (JSON)" error={physicalErrors.attributes} hint='Example: {"color":"Rose","size":"250ml"}'>
                <Textarea value={physicalForm.attributes_json} onChange={(e) => updatePhysicalField("attributes_json", e.target.value, ["attributes"])} rows={5} className={fieldClassName("attributes")} />
              </Field>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPhysicalForm(false);
                    setPhysicalErrors({});
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={savePhysical} disabled={savingPhysical}>
                  {savingPhysical ? "Saving..." : "Save"}
                </Button>
              </div>
            </FormCard>
          )}

          <div className="space-y-3">
            {physicalLoading ? <LoadingSpinner /> : filteredPhysical.length === 0 ? <EmptyState icon={Store} text="No products" /> : filteredPhysical.map((product) => (
              <div key={product.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                {product.featured_image ? <img src={product.featured_image} alt="" className="h-12 w-12 rounded-lg object-cover" /> : null}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-sm truncate">{product.title}</h4>
                    <StatusBadge status={product.status} />
                    {product.bestseller ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Bestseller</span> : null}
                    {product.featured ? <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">Featured</span> : null}
                    {product.stock_quantity <= 5 && product.stock_quantity > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Low Stock</span> : null}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {product.category}{product.subcategory ? ` / ${product.subcategory}` : ""} · {formatPrice(product.sale_price ?? product.price)} · Stock: {product.stock_quantity}{product.sku ? ` · SKU: ${product.sku}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn onClick={() => openEditPhysical(product)} title="Edit"><Pencil className="h-4 w-4" /></IconBtn>
                  <IconBtn onClick={() => setPhysicalProductToDelete(product)} title="Delete" danger><Trash2 className="h-4 w-4" /></IconBtn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === "virtual" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total" value={(products ?? []).length} />
            <StatCard label="Active" value={(products ?? []).filter((product) => (product as any).status === "active").length} color="text-emerald-600" />
            <StatCard label="Draft" value={(products ?? []).filter((product) => (product as any).status === "draft").length} color="text-amber-600" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search programs..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} className="pl-9" />
            </div>
            <Button onClick={() => { setEditingProductId(null); setProductForm(emptyProductForm); setShowProductForm(true); }} className="rounded-xl"><Plus className="h-4 w-4" /> Add Program</Button>
          </div>
          {showProductForm && (
            <FormCard title={editingProductId ? "Edit Program" : "Add Program"} onClose={() => setShowProductForm(false)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title *"><Input value={productForm.title} onChange={(e) => setProductForm({ ...productForm, title: e.target.value })} /></Field>
                <Field label="Slug *"><Input value={productForm.slug} onChange={(e) => setProductForm({ ...productForm, slug: e.target.value })} /></Field>
                <Field label="Subtitle"><Input value={productForm.subtitle} onChange={(e) => setProductForm({ ...productForm, subtitle: e.target.value })} /></Field>
                <Field label="Price *"><Input type="number" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} /></Field>
                <Field label="Max Price"><Input type="number" value={productForm.price_max} onChange={(e) => setProductForm({ ...productForm, price_max: e.target.value })} /></Field>
                <Field label="Format"><Input value={productForm.format} onChange={(e) => setProductForm({ ...productForm, format: e.target.value })} /></Field>
                <Field label="Badge"><Input value={productForm.badge} onChange={(e) => setProductForm({ ...productForm, badge: e.target.value })} /></Field>
                <Field label="Icon">
                  <Select value={productForm.icon} onValueChange={(value) => setProductForm({ ...productForm, icon: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ICON_OPTIONS.map((icon) => <SelectItem key={icon} value={icon}>{icon}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={productForm.status} onValueChange={(value) => setProductForm({ ...productForm, status: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRODUCT_STATUSES.map((status) => <SelectItem key={status} value={status} className="capitalize">{status.replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Sort Order"><Input type="number" value={productForm.sort_order} onChange={(e) => setProductForm({ ...productForm, sort_order: e.target.value })} /></Field>
              </div>
              <Field label="Description"><Textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} rows={3} /></Field>
              <Field label="Includes (one per line)"><Textarea value={productForm.includes} onChange={(e) => setProductForm({ ...productForm, includes: e.target.value })} rows={4} /></Field>
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={() => setShowProductForm(false)}>Cancel</Button>
                <Button onClick={saveProduct} disabled={savingProduct}>{savingProduct ? "Saving..." : "Save"}</Button>
              </div>
            </FormCard>
          )}
          <div className="space-y-3">
            {productsLoading ? <LoadingSpinner /> : filteredProducts.length === 0 ? <EmptyState icon={ShoppingBag} text="No programs" /> : filteredProducts.map((product) => (
              <div key={product.id} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-sm truncate">{product.title}</h4>
                    <StatusBadge status={(product as any).status ?? "active"} />
                    {product.badge ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${product.badge_color}`}>{product.badge}</span> : null}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {formatPrice(product.price)}{product.price_max ? `-${formatPrice(product.price_max)}` : ""}{product.format ? ` · ${product.format}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn onClick={() => toggleProductStatus(product)} title={product.is_active ? "Deactivate" : "Activate"}>{product.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</IconBtn>
                  <IconBtn onClick={() => openEditProduct(product)} title="Edit"><Pencil className="h-4 w-4" /></IconBtn>
                  <IconBtn onClick={() => setVirtualProductToDelete(product)} title="Delete" danger><Trash2 className="h-4 w-4" /></IconBtn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmActionDialog
        open={Boolean(physicalProductToDelete)}
        onOpenChange={(open) => { if (!open) setPhysicalProductToDelete(null); }}
        title="Delete this product?"
        description={physicalProductToDelete ? `This will permanently remove "${physicalProductToDelete.title}" from the physical catalog.` : undefined}
        confirmLabel="Delete product"
        destructive
        onConfirm={deletePhysical}
      />
      <ConfirmActionDialog
        open={Boolean(virtualProductToDelete)}
        onOpenChange={(open) => { if (!open) setVirtualProductToDelete(null); }}
        title="Delete this program?"
        description={virtualProductToDelete ? `This will permanently remove "${virtualProductToDelete.title}" from the virtual catalog.` : undefined}
        confirmLabel="Delete program"
        destructive
        onConfirm={deleteProduct}
      />
    </div>
  );
};
