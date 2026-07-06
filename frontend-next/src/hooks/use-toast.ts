import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

type ToastInput = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
  action?: ReactNode;
  duration?: number;
};

function toast({ title, description, variant, action, duration }: ToastInput) {
  const id = sonnerToast(title ?? "", {
    description,
    action: action as never,
    duration,
    className:
      variant === "destructive"
        ? "border-destructive bg-destructive text-destructive-foreground"
        : undefined,
  });

  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
    update: (next: ToastInput) => toast(next),
  };
}

function useToast() {
  return {
    toasts: [],
    toast,
    dismiss: (toastId?: string) => sonnerToast.dismiss(toastId),
  };
}

export { useToast, toast };
