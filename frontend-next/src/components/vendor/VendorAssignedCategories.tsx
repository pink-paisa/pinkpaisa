import { Vendor } from "@/lib/vendor";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";

const VendorAssignedCategories = ({ vendor, compact = false }: { vendor?: Vendor | null; compact?: boolean }) => {
  const categories = vendor?.assigned_categories ?? [];
  const { data: taxonomy } = useProductTaxonomy();

  if (!categories.length) {
    return (
      <div className={compact
        ? "text-sm leading-6 text-[#8d6b77]"
        : "rounded-[1.2rem] border border-dashed border-[#ecd8de] bg-[#fff8fa] px-4 py-4 text-sm leading-6 text-[#8d6b77]"}>
        No specific admin category restrictions set. This vendor can upload into active wellness categories.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {categories.map((category) => {
        const taxonomyCategory = taxonomy?.find((t) => t.id === category.id);
        const subcategories = taxonomyCategory?.subcategories ?? [];

        return (
          <div key={category.id} className="flex flex-col items-start gap-2">
            <span className={`inline-flex items-center rounded-full border border-[#efd3db] bg-[#fff4f7] font-medium text-[#6b3f4f] shadow-sm ${compact ? "px-3 py-1 text-xs" : "px-3.5 py-2 text-sm"}`}>
              {compact ? "🌸 " : "✿ "}{category.name}
            </span>
            {subcategories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-1">
                {subcategories.map((sub) => (
                  <span
                    key={sub.id}
                    className={`inline-flex items-center rounded-full border border-[#f2e8dc] bg-[#fffaf3] text-[#8d6b77] ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"}`}
                  >
                    {sub.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default VendorAssignedCategories;
