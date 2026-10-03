import type { Metadata } from "next";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "./globals.css";
import "./conversation.css";
const SITE = "https://ayushbh.com";
const TITLE = "Ayush Bhattacharya — Intelligent software";
const DESCRIPTION =
  "Quantitative roots. Thoughtful AI systems and software. Explore the work of Ayush Bhattacharya, based in Vienna.";
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Ayush Bhattacharya",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.jpg"],
  },
};
// Facts here are the ones already public on the page.
const PERSON = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Ayush Bhattacharya",
  url: SITE,
  address: {
    "@type": "PostalAddress",
    addressLocality: "Vienna",
    addressCountry: "AT",
  },
  sameAs: [
    "https://www.linkedin.com/in/ayush-bhattacharya-ba09b6162",
    "https://github.com/Ayushbh6",
  ],
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(PERSON) }}
        />
      </body>
    </html>
  );
}
