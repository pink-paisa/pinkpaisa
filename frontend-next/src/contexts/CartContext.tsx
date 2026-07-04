import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { customerFetch, useCustomerAuth } from "@/contexts/CustomerAuthContext";

export type CartItem = {
  id: string;
  title: string;
  price: number;
  priceMax: number;
  format?: string;
  image_url?: string | null;
  slug?: string | null;
  stock_quantity_at_add?: number | null;
  quantity: number;
};

type CartContextType = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  validateCart: () => Promise<void>;
  totalItems: number;
  subtotal: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  cartNotices: string[];
  isValidating: boolean;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_KEY = "pinkpaisa_cart";

type CartValidationResponse = {
  items: CartItem[];
  notices: string[];
};

const normalizeQuantityForItem = (item: Omit<CartItem, "quantity"> | CartItem, quantity: number) => {
  const requested = Math.max(Number(quantity || 1), 1);
  if (item.stock_quantity_at_add == null) return requested;
  return Math.min(requested, Math.max(item.stock_quantity_at_add, 1));
};

const mergeCartItems = (localItems: CartItem[], remoteItems: CartItem[]) => {
  const mergedMap = new Map<string, CartItem>();

  for (const item of [...remoteItems, ...localItems]) {
    const existing = mergedMap.get(item.id);
    const nextQuantity = existing ? existing.quantity + item.quantity : item.quantity;
    const preferred = existing ? { ...item, ...existing } : item;
    mergedMap.set(item.id, {
      ...preferred,
      quantity: normalizeQuantityForItem(preferred, nextQuantity),
    });
  }

  return Array.from(mergedMap.values());
};

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartNotices, setCartNotices] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const { user } = useCustomerAuth();
  const syncedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(CART_KEY);
      setItems(stored ? JSON.parse(stored) : []);
    } catch {
      setItems([]);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hydrated) return;
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }, [hydrated, items]);

  useEffect(() => {
    if (!user?.id) {
      syncedUserIdRef.current = null;
      return;
    }
    if (!hydrated || syncedUserIdRef.current === user.id) return;

    let cancelled = false;

    customerFetch<CartItem[]>("/account/cart")
      .then((remoteItems) => {
        if (cancelled) return;
        setItems((current) => mergeCartItems(current, Array.isArray(remoteItems) ? remoteItems : []));
        syncedUserIdRef.current = user.id;
      })
      .catch(() => {
        if (!cancelled) syncedUserIdRef.current = user.id;
      });

    return () => {
      cancelled = true;
    };
  }, [hydrated, user?.id]);

  useEffect(() => {
    if (!hydrated || !user?.id) return;
    const timer = window.setTimeout(() => {
      customerFetch("/account/cart", {
        method: "PUT",
        body: JSON.stringify({ items }),
      }).catch(() => undefined);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [hydrated, items, user?.id]);

  const validateCart = useCallback(async () => {
    if (!items.length) {
      setCartNotices([]);
      return;
    }

    setIsValidating(true);
    try {
      const response = await apiFetch<CartValidationResponse>("/products/cart-validate", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      setItems(response.items || []);
      setCartNotices(response.notices || []);
    } catch {
      setCartNotices([]);
    } finally {
      setIsValidating(false);
    }
  }, [items]);

  useEffect(() => {
    if (!hydrated || !isCartOpen) return;
    validateCart();
    const intervalId = window.setInterval(() => {
      validateCart().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, [hydrated, isCartOpen, validateCart]);

  const addItem = useCallback((item: Omit<CartItem, "quantity">, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) =>
          i.id === item.id
            ? { ...i, ...item, quantity: normalizeQuantityForItem({ ...i, ...item }, i.quantity + quantity) }
            : i
        );
      }
      return [...prev, { ...item, quantity: normalizeQuantityForItem(item, quantity) }];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    if (quantity < 1) return;
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, quantity: normalizeQuantityForItem(i, quantity) } : i))
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setCartNotices([]);
  }, []);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const value = useMemo(
    () => ({
      items,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      validateCart,
      totalItems,
      subtotal,
      isCartOpen,
      setIsCartOpen,
      cartNotices,
      isValidating,
    }),
    [items, addItem, removeItem, updateQuantity, clearCart, validateCart, totalItems, subtotal, isCartOpen, cartNotices, isValidating],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
};
