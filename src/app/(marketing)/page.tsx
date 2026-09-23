import type { Metadata } from "next";
import { getSession } from "@/server/auth/session";
import { isPreview } from "@/shared/lib/site-url";
import {
  LandingCapabilities,
  LandingCta,
  LandingFooter,
  LandingHero,
  LandingMemory,
  LandingNav,
  LandingPricing,
  ScrollVideo,
} from "@/widgets/landing";

const title = "PrismPM - project management with a memory";
const description =
  "Keep Tasks, Decisions and Evidence in one workspace. See which Assumptions have broken, understand what changed, and recover the reasoning behind your Project.";
const socialImage = {
  url: "/opengraph-image",
  alt: "PrismPM. Stand above the whole project. Project management with a memory.",
  width: 1200,
  height: 630,
};

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/" },
  robots: { index: !isPreview, follow: !isPreview },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "PrismPM",
    title,
    description,
    url: "/",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImage],
  },
};

/**
 * The landing page is the one screen a visitor sees before the database matters, so a
 * session lookup that fails degrades to signed-out rather than failing the whole page.
 */
async function isSignedIn() {
  try {
    return (await getSession()) !== null;
  } catch {
    return false;
  }
}

export default async function LandingPage() {
  const signedIn = await isSignedIn();

  return (
    <div data-landing className="flex flex-1 flex-col bg-canvas">
      <LandingNav signedIn={signedIn} />
      <main id="main-content" className="flex-1">
        <LandingHero signedIn={signedIn} />
        <ScrollVideo />
        <LandingMemory />
        <LandingCapabilities />
        <LandingPricing signedIn={signedIn} />
        <LandingCta signedIn={signedIn} />
      </main>
      <LandingFooter />
    </div>
  );
}
