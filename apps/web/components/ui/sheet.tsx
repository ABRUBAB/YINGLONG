"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { cn } from "@yinglong/ui";
import { CloseIcon } from "./button";

/**
 * Sheet (right drawer on desktop, bottom sheet on phones) and centred Dialog, on Base UI Dialog.
 * Solid surfaces only: no blur, no translucency beyond the backdrop scrim.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = "right",
  width = 480,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  side?: "right" | "bottom";
  width?: number;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="yl-backdrop z-40" />
        <Dialog.Popup
          className={cn(
            "yl-drawer fixed z-50 flex flex-col border-line-2 bg-bg-1 text-fg-1 outline-none",
            side === "right"
              ? "inset-y-0 right-0 w-full border-l sm:w-[var(--sheet-w)] sm:rounded-l-sheet"
              : "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-sheet border-t",
          )}
          style={{ ["--sheet-w" as string]: `${width}px` }}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line-1 px-5 pt-5 pb-4">
            <div className="min-w-0">
              <Dialog.Title className="m-0 text-18 font-semibold text-fg-0">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 mb-0 text-13 text-fg-muted">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close
              className="-mt-1 -mr-2 inline-flex size-9 items-center justify-center rounded-control text-fg-2 hover:bg-bg-3 hover:text-fg-0"
              aria-label="Close"
            >
              <CloseIcon />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer ? <footer className="border-t border-line-1 px-5 py-4">{footer}</footer> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="yl-backdrop z-40" />
        <Dialog.Popup className="yl-dialog fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-sheet border border-line-2 bg-bg-1 p-6 text-fg-1 outline-none">
          <Dialog.Title className="m-0 text-18 font-semibold text-fg-0">{title}</Dialog.Title>
          <div className="mt-3 text-13 text-fg-2">{children}</div>
          <div className="mt-6 flex flex-wrap justify-end gap-2">{actions}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const DialogClose = Dialog.Close;
