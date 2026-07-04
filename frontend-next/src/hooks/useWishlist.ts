import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customerFetch, useCustomerAuth } from "@/contexts/CustomerAuthContext";

export type WishlistProductSummary = {
  id: string;
  slug: string;
  title: string;
  featured_image: string | null;
  price: number;
  sale_price: number | null;
  stock_quantity: number;
};

export type WishlistItem = {
  id: string;
  created_at?: string;
  product: WishlistProductSummary;
};

type WishlistToggleProduct = WishlistProductSummary;

export const useWishlist = () => {
  const { user } = useCustomerAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["wishlist"],
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => customerFetch<WishlistItem[]>("/wishlist"),
  });

  const wishlistItems = user ? query.data ?? [] : [];
  const wishlistIdSet = useMemo(
    () => new Set(wishlistItems.map((item) => item.product.id)),
    [wishlistItems],
  );

  const addMutation = useMutation({
    mutationFn: async (product: WishlistToggleProduct) => {
      await customerFetch("/wishlist", {
        method: "POST",
        body: JSON.stringify({ product_id: product.id }),
      });
      return product;
    },
    onMutate: async (product) => {
      await queryClient.cancelQueries({ queryKey: ["wishlist"] });
      const previous = queryClient.getQueryData<WishlistItem[]>(["wishlist"]) ?? [];
      if (!previous.some((item) => item.product.id === product.id)) {
        queryClient.setQueryData<WishlistItem[]>(["wishlist"], [
          {
            id: `pending-${product.id}`,
            created_at: new Date().toISOString(),
            product,
          },
          ...previous,
        ]);
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["wishlist"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (productId: string) => {
      await customerFetch(`/wishlist/${productId}`, { method: "DELETE" });
      return productId;
    },
    onMutate: async (productId) => {
      await queryClient.cancelQueries({ queryKey: ["wishlist"] });
      const previous = queryClient.getQueryData<WishlistItem[]>(["wishlist"]) ?? [];
      queryClient.setQueryData<WishlistItem[]>(
        ["wishlist"],
        previous.filter((item) => item.product.id !== productId),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["wishlist"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist"] });
    },
  });

  const toggleWishlist = async (product: WishlistToggleProduct) => {
    if (!user) {
      throw new Error("Login to use wishlist");
    }
    if (wishlistIdSet.has(product.id)) {
      await removeMutation.mutateAsync(product.id);
      return false;
    }
    await addMutation.mutateAsync(product);
    return true;
  };

  const isWishlisted = (productId: string) => wishlistIdSet.has(productId);

  return {
    ...query,
    wishlistItems,
    wishlistIdSet,
    wishlistCount: wishlistItems.length,
    isWishlisted,
    toggleWishlist,
    isPending: addMutation.isPending || removeMutation.isPending,
  };
};
