import { ArrowLeft } from "lucide-react";

export default function Privacy() {
  return (
    <main
      className="section"
      style={{ maxWidth: 850, margin: "auto", minHeight: "100vh" }}
    >
      <a className="inline-link" href="/">
        <ArrowLeft size={16} aria-hidden="true" /> Back to portfolio
      </a>
      <h1 style={{ fontSize: 70, margin: "50px 0 25px" }}>
        A note on privacy.
      </h1>
      <p style={{ lineHeight: 2 }}>
        When you start a conversation, your microphone (voice mode only) and
        anything you type pass through this site’s server to Google’s Gemini
        service so the assistant (Iris) can answer. This site does not store
        your audio, and it sets no tracking cookies or analytics. The microphone
        is used only while a conversation is open, and you can mute it or end
        the conversation at any time.
      </p>
      <p style={{ lineHeight: 2, marginTop: 25 }}>
        <strong>What is saved.</strong> The text of the conversation (what you
        type, a transcript of what is said, and the assistant’s replies), the
        pages and views shown, and the time and cost of each conversation are
        saved so that Ayush can read them and improve the assistant. They are
        linked only to a random visitor ID, never to a name or account, and are
        deleted automatically after 90 days. Ayush is the only person who can
        read them. Please do not share sensitive personal information with the
        assistant.
      </p>
      <p style={{ lineHeight: 2, marginTop: 25 }}>
        <strong>Leaving a message.</strong> If you use the “leave a message”
        form, your name, email address and message are saved, read by Ayush
        only, and kept for up to a year. Ayush gets a short notification that a
        message arrived; it never contains your details.
      </p>
      <p style={{ lineHeight: 2, marginTop: 25 }}>
        <strong>Abuse protection.</strong> A short browser check from Cloudflare
        (Turnstile) runs before your first conversation, usually invisibly. It
        gives your browser a random visitor token, stored in your browser’s
        local storage and a secure cookie used only for abuse protection.
        Renewing the token keeps the same visitor ID. Your network address is
        used in a one-way hashed form to apply hourly and daily limits, and
        conversations are limited in length and number. The site is hosted on
        Cloudflare.
      </p>
      <p style={{ lineHeight: 2, marginTop: 25 }}>
        <strong>Deletion and questions.</strong> To have a conversation or
        message removed sooner, email{" "}
        <a className="inline-link" href="mailto:bhatt.ayush.1998@gmail.com">
          bhatt.ayush.1998@gmail.com
        </a>{" "}
        with the approximate time it happened. Messages you send to Ayush by
        email are handled by your own email provider.
      </p>
    </main>
  );
}
