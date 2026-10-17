import { BrandSpinner } from "@/components/brand/loader";

/** Shown while a page is being fetched: the brand loader, centred under the bar. */
export default function Loading() {
  return (
    <main id="main" className="grid min-h-[60dvh] place-items-center">
      <BrandSpinner size={72} label="Loading" />
    </main>
  );
}
