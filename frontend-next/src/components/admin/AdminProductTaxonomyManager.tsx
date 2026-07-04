import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import TextActionDialog from "@/components/ui/text-action-dialog";

type TaxonomyPromptState =
  | { kind: "create-category"; title: string; description: string; label: string; initialValue: string; confirmLabel: string }
  | { kind: "edit-category"; id: string; currentName: string; title: string; description: string; label: string; initialValue: string; confirmLabel: string }
  | { kind: "create-subcategory"; categoryId: string; categoryName: string; title: string; description: string; label: string; initialValue: string; confirmLabel: string }
  | { kind: "edit-subcategory"; id: string; currentName: string; title: string; description: string; label: string; initialValue: string; confirmLabel: string };

type TaxonomyConfirmState =
  | { kind: "delete-category"; id: string; name: string; title: string; description: string }
  | { kind: "delete-subcategory"; id: string; name: string; title: string; description: string };

export const AdminProductTaxonomyManager = () => {
  const queryClient = useQueryClient();
  const { data: categories, isLoading } = useProductTaxonomy({ includeInactive: true, includeUncategorized: true });
  const visibleCategories = useMemo(() => (categories ?? []).filter((item) => item.slug !== "uncategorized"), [categories]);
  const [promptState, setPromptState] = useState<TaxonomyPromptState | null>(null);
  const [confirmState, setConfirmState] = useState<TaxonomyConfirmState | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["product_taxonomy"] });
    queryClient.invalidateQueries({ queryKey: ["catalog_products"] });
    queryClient.invalidateQueries({ queryKey: ["physical_products"] });
  };

  const openPrompt = (state: TaxonomyPromptState) => {
    setPromptState(state);
    setPromptValue(state.initialValue);
  };

  const createCategory = () => {
    openPrompt({
      kind: "create-category",
      title: "Create category",
      description: "Add a new top-level wellness category for the storefront taxonomy.",
      label: "Category name",
      initialValue: "",
      confirmLabel: "Create category",
    });
  };

  const submitPrompt = async () => {
    if (!promptState || !promptValue.trim()) return;
    const trimmedValue = promptValue.trim();
    try {
      if (promptState.kind === "create-category") {
        await apiFetch("/categories", { method: "POST", body: JSON.stringify({ name: trimmedValue }) });
        toast.success("Category created");
      } else if (promptState.kind === "edit-category") {
        if (trimmedValue === promptState.currentName) {
          setPromptState(null);
          return;
        }
        await apiFetch(`/categories/${promptState.id}`, { method: "PUT", body: JSON.stringify({ name: trimmedValue }) });
        toast.success("Category renamed");
      } else if (promptState.kind === "create-subcategory") {
        await apiFetch("/categories/subcategories", {
          method: "POST",
          body: JSON.stringify({ category_id: promptState.categoryId, name: trimmedValue }),
        });
        toast.success("Subcategory created");
      } else if (promptState.kind === "edit-subcategory") {
        if (trimmedValue === promptState.currentName) {
          setPromptState(null);
          return;
        }
        await apiFetch(`/categories/subcategories/${promptState.id}`, { method: "PUT", body: JSON.stringify({ name: trimmedValue }) });
        toast.success("Subcategory renamed");
      }
      setPromptState(null);
      setPromptValue("");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update taxonomy");
    }
  };

  const editCategory = (id: string, currentName: string) =>
    openPrompt({
      kind: "edit-category",
      id,
      currentName,
      title: "Rename category",
      description: `Update the storefront category name for "${currentName}".`,
      label: "Category name",
      initialValue: currentName,
      confirmLabel: "Save category",
    });

  const deleteCategory = (id: string, name: string) => {
    setConfirmState({
      kind: "delete-category",
      id,
      name,
      title: "Delete this category?",
      description: `Products in "${name}" will move to Uncategorized and disappear from the public store until they are reassigned.`,
    });
  };

  const submitDelete = async () => {
    if (!confirmState) return;
    try {
      if (confirmState.kind === "delete-category") {
        await apiFetch(`/categories/${confirmState.id}`, { method: "DELETE" });
        toast.success("Category deleted");
      } else {
        await apiFetch(`/categories/subcategories/${confirmState.id}`, { method: "DELETE" });
        toast.success("Subcategory deleted");
      }
      setConfirmState(null);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete taxonomy item");
    }
  };

  const createSubcategory = (categoryId: string, categoryName: string) =>
    openPrompt({
      kind: "create-subcategory",
      categoryId,
      categoryName,
      title: "Create subcategory",
      description: `Add a new subcategory under "${categoryName}".`,
      label: "Subcategory name",
      initialValue: "",
      confirmLabel: "Create subcategory",
    });

  const editSubcategory = (id: string, currentName: string) =>
    openPrompt({
      kind: "edit-subcategory",
      id,
      currentName,
      title: "Rename subcategory",
      description: `Update the subcategory name for "${currentName}".`,
      label: "Subcategory name",
      initialValue: currentName,
      confirmLabel: "Save subcategory",
    });

  const deleteSubcategory = (id: string, name: string) =>
    setConfirmState({
      kind: "delete-subcategory",
      id,
      name,
      title: "Delete this subcategory?",
      description: `Products in "${name}" will move to Uncategorized until they are reassigned.`,
    });

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Wellness Taxonomy</p>
          <h3 className="mt-1 font-serif text-xl">Categories and subcategories</h3>
        </div>
        <Button className="rounded-xl" onClick={createCategory}><Plus className="h-4 w-4" /> Add Category</Button>
      </div>

      {isLoading ? (
        <div className="py-10 text-sm text-muted-foreground">Loading taxonomy...</div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleCategories.map((category) => (
            <div key={category.id} className="rounded-2xl border border-border/80 bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{category.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{category.subcategories.length} subcategories</p>
                </div>
                <div className="flex items-center gap-1">
                  <button className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => createSubcategory(category.id, category.name)} title="Add subcategory"><Plus className="h-4 w-4" /></button>
                  <button className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => editCategory(category.id, category.name)} title="Rename category"><Pencil className="h-4 w-4" /></button>
                  <button className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-700" onClick={() => deleteCategory(category.id, category.name)} title="Delete category"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {category.subcategories.map((subcategory) => (
                  <div key={subcategory.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2 text-sm">
                    <span>{subcategory.name}</span>
                    <div className="flex items-center gap-1">
                      <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => editSubcategory(subcategory.id, subcategory.name)} title="Rename subcategory"><Pencil className="h-3.5 w-3.5" /></button>
                      <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-700" onClick={() => deleteSubcategory(subcategory.id, subcategory.name)} title="Delete subcategory"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
                {category.subcategories.length === 0 && <p className="text-sm text-muted-foreground">No subcategories yet.</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      <TextActionDialog
        open={Boolean(promptState)}
        onOpenChange={(open) => {
          if (!open) {
            setPromptState(null);
            setPromptValue("");
          }
        }}
        title={promptState?.title ?? "Update taxonomy"}
        description={promptState?.description}
        label={promptState?.label ?? "Name"}
        value={promptValue}
        onValueChange={setPromptValue}
        onConfirm={submitPrompt}
        confirmLabel={promptState?.confirmLabel ?? "Save"}
        placeholder="Enter a name"
        disabled={!promptValue.trim()}
      />
      <ConfirmActionDialog
        open={Boolean(confirmState)}
        onOpenChange={(open) => { if (!open) setConfirmState(null); }}
        title={confirmState?.title ?? "Delete taxonomy item?"}
        description={confirmState?.description}
        confirmLabel={confirmState?.kind === "delete-category" ? "Delete category" : "Delete subcategory"}
        destructive
        onConfirm={submitDelete}
      />
    </section>
  );
};

export default AdminProductTaxonomyManager;
