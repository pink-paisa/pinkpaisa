import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { CartProvider } from "@/contexts/CartContext";
import { VendorAuthProvider } from "@/contexts/VendorAuthContext";
import { CustomerAuthProvider } from "@/contexts/CustomerAuthContext";
import CartDrawer from "@/components/CartDrawer";
import { ReactNode, useState } from "react";

export default function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <CustomerAuthProvider>
          <VendorAuthProvider>
            <CartProvider>
              <CartDrawer />
              {children}
            </CartProvider>
          </VendorAuthProvider>
        </CustomerAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
