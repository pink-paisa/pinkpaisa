import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TextActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
  pending?: boolean;
  multiline?: boolean;
  disabled?: boolean;
};

export const TextActionDialog = ({
  open,
  onOpenChange,
  title,
  description,
  label,
  value,
  onValueChange,
  onConfirm,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  placeholder,
  pending = false,
  multiline = false,
  disabled = false,
}: TextActionDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="rounded-2xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <div className="space-y-2">
        <Label>{label}</Label>
        {multiline ? (
          <Textarea
            rows={4}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
          />
        ) : (
          <Input
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
          />
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          onClick={() => {
            void onConfirm();
          }}
          disabled={pending || disabled}
        >
          {pending ? "Saving..." : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default TextActionDialog;
