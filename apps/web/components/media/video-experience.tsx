"use client";

import { useId, useRef, useState } from "react";
import { isUploaded } from "@/content/film";
import { ArrowIcon, Button, ButtonLink, CloseIcon } from "@/components/ui/button";
import "./video-experience.css";

type VideoExperienceProps = {
  src: string;
  title: string;
  eyebrow: string;
  buttonLabel: string;
  captionsSrc?: string;
  ctaHref?: string;
  ctaLabel?: string;
  size?: "md" | "lg";
};

export function VideoExperience({ src, title, eyebrow, buttonLabel, captionsSrc, ctaHref, ctaLabel, size = "lg" }: VideoExperienceProps) {
  const [open, setOpen] = useState(false);
  // The button is always there. Until the file is uploaded (content/film.ts) the window says so instead of playing.
  const uploaded = isUploaded(src);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  function openVideo() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setOpen(true);
  }

  function closeVideo() {
    if (dialogRef.current?.open) dialogRef.current.close();
  }

  return (
    <>
      <Button variant="primary" size={size} onClick={openVideo} aria-haspopup="dialog">
        {buttonLabel}
        <ArrowIcon />
      </Button>
      <dialog
        ref={dialogRef}
        className="yl-video-dialog"
        aria-labelledby={titleId}
        onClose={() => {
          const video = dialogRef.current?.querySelector("video");
          video?.pause();
          if (video && video.readyState > 0) video.currentTime = 0;
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeVideo();
        }}
      >
        <section className="grid gap-4 p-4 sm:gap-5 sm:p-6">
          <header className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <p className="eyebrow m-0 text-fg-muted">{eyebrow}</p>
              <h2 id={titleId} className="m-0 text-18 font-semibold text-fg-0 sm:text-22">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeVideo}
              aria-label="Close video"
              autoFocus
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-line-2 text-fg-1 transition-colors hover:border-accent hover:text-fg-0 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <CloseIcon />
            </button>
          </header>
          {uploaded ? (
            <video key={src} className="yl-video-player" src={open ? src : undefined} controls autoPlay playsInline preload="metadata" aria-label={title}>
              {captionsSrc ? <track kind="captions" src={captionsSrc} srcLang="en" label="English" default /> : null}
              Your browser does not support HTML video.
            </video>
          ) : (
            <div className="yl-video-soon" role="status">
              <p className="m-0 text-18 font-semibold text-fg-0 sm:text-22">This video will be uploaded soon.</p>
              <p className="m-0 text-13 text-fg-2 sm:text-15">Please check back shortly.</p>
            </div>
          )}
          {ctaHref && ctaLabel ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 text-12 text-fg-muted">Continue exploring YINGLONG.</p>
              <ButtonLink href={ctaHref} onClick={closeVideo} variant="primary" size="sm">
                {ctaLabel}
              </ButtonLink>
            </div>
          ) : null}
        </section>
      </dialog>
    </>
  );
}
