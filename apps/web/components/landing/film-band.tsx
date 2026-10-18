import { VideoExperience } from "@/components/media/video-experience";
import { FILM_SRC } from "@/content/film";

export function FilmBand() {
  // The film window says "will be uploaded soon" until the file is listed in content/film.ts.
  return (
    <section aria-labelledby="film-title" className="border-y border-line-1 bg-bg-0 text-fg-1">
      <div className="yl-container grid justify-items-center gap-5 py-10 text-center sm:py-12">
        <div className="grid justify-items-center gap-3">
          <p className="eyebrow m-0 flex items-center justify-center gap-3 text-fg-muted">
            <span aria-hidden="true" className="h-px w-6 bg-accent" />
            YINGLONG · 5-minute project film
            <span aria-hidden="true" className="h-px w-6 bg-accent" />
          </p>
          <h2 id="film-title" className="type-display m-0 text-22 text-fg-0 sm:text-26">
            How YINGLONG keeps AI agents within your rules
          </h2>
          <p className="m-0 max-w-[54ch] text-13 text-fg-2 sm:text-15">
            The five-minute project film introduces YINGLONG: an AI agent follows the spending rules you set, asks when approval is needed, and leaves a record you can check.
          </p>
        </div>
        <VideoExperience
          src={FILM_SRC}
          eyebrow="YINGLONG project film"
          title="How YINGLONG keeps AI agents within your rules"
          buttonLabel="Watch the 5-minute film"
          ctaHref="/judge"
          ctaLabel="Take the 3-minute walkthrough"
        />
      </div>
    </section>
  );
}
