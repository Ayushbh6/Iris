"use client";
import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  AudioLines,
  Menu,
  X,
} from "lucide-react";
import { projects, experience, type ProjectId } from "../lib/content";
const Conversation = dynamic(() => import("./Conversation"), { ssr: false });
export default function Portfolio() {
  const [canvas, setCanvas] = useState<{
    mode: "voice" | "text" | "project";
    project?: ProjectId;
  } | null>(null);
  const [menu, setMenu] = useState(false);
  const lastFocus = useRef<HTMLElement | null>(null);
  function open(mode: "voice" | "text" | "project", project?: ProjectId) {
    lastFocus.current = document.activeElement as HTMLElement;
    setCanvas({ mode, project });
    setMenu(false);
  }
  function close() {
    setCanvas(null);
    setTimeout(() => lastFocus.current?.focus(), 0);
  }
  useEffect(() => {
    document.body.style.overflow = canvas ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [canvas]);
  return (
    <>
      <main inert={canvas ? true : undefined}>
        <section className="hero" id="home">
          <img
            className="hero-image"
            src="/assets/hero.png"
            alt="A quiet desk overlooking Vienna in the evening light"
            fetchPriority="high"
          />
          <header className="header">
            <a
              href="#home"
              className="brand"
              aria-label="Ayush Bhattacharya home"
            >
              <img src="/assets/wordmark.png" alt="Ayush Bhattacharya" />
            </a>
            <nav
              aria-label="Main navigation"
              className={menu ? "nav open" : "nav"}
            >
              <a href="#work" onClick={() => setMenu(false)}>
                Work
              </a>
              <a href="#experience" onClick={() => setMenu(false)}>
                Experience
              </a>
              <a href="#about" onClick={() => setMenu(false)}>
                About
              </a>
            </nav>
            <button className="button nav-voice" onClick={() => open("voice")}>
              <AudioLines size={21} />
              Talk to my AI
            </button>
            <button
              className="menu-button"
              onClick={() => setMenu(!menu)}
              aria-label={menu ? "Close menu" : "Open menu"}
              aria-expanded={menu}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </header>
          <div className="hero-content">
            <p className="eyebrow intro">
              QUANTITATIVE ROOTS.
              <br />
              REAL-WORLD IMPACT.
            </p>
            <h1>
              I Build
              <br />
              Intelligent
              <br />
              <em>Software</em>
            </h1>
            <div className="hero-actions">
              <button
                className="button hero-button"
                onClick={() => open("voice")}
              >
                <AudioLines />
                Talk to my AI
                <ArrowRight size={22} />
              </button>
              <button className="text-option" onClick={() => open("text")}>
                Prefer text?{" "}
                <span>
                  Chat instead <ArrowUpRight size={14} aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
          <div className="hero-bottom">
            <span>
              <i /> VIENNA, AT
            </span>
            <a href="#work">
              EXPLORE THE WORK <ArrowDown size={14} />
            </a>
            <span className="hero-motto">
              IDEAS <span>→</span> SYSTEMS <span>→</span> IMPACT
            </span>
          </div>
        </section>
        <section className="work section" id="work">
          <div className="section-top">
            <p className="eyebrow">01 / SELECTED WORK</p>
            <span className="small-note">
              Built with intent. Open to inspection.
            </span>
          </div>
          <div className="section-heading">
            <h2>
              Ideas, made <em>real.</em>
            </h2>
            <p>
              AI systems, document intelligence and financial information. A few
              things I’m building and exploring.
            </p>
          </div>
          <div className="project-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className="project-row"
                onClick={() => open("project", p.id)}
              >
                <span className="project-number">{p.number}</span>
                <div>
                  <span className="eyebrow">{p.category}</span>
                  <h3>{p.name}</h3>
                  <p>{p.description}</p>
                </div>
                <div className={"project-art " + p.id} aria-hidden="true">
                  {p.id === "socrates" ? (
                    <>
                      <span className="orbit o1" />
                      <span className="orbit o2" />
                      <span className="orbit o3" />
                      <span className="core">s.</span>
                    </>
                  ) : p.id === "checker" ? (
                    <>
                      <span className="paper back" />
                      <span className="paper front">
                        <i />
                        <i />
                        <i />
                        <b>✓</b>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="chart-bar" />
                      <span className="chart-bar" />
                      <span className="chart-bar" />
                      <span className="chart-bar" />
                      <span className="chart-bar" />
                    </>
                  )}
                </div>
                <ArrowUpRight className="project-arrow" />
              </button>
            ))}
          </div>
        </section>
        <section className="experience section" id="experience">
          <div className="section-top">
            <p className="eyebrow">02 / EXPERIENCE</p>
            <span className="small-note">
              A quantitative foundation. A builder’s perspective.
            </span>
          </div>
          <div className="experience-layout">
            <h2>
              Connecting
              <br />
              the <em>disciplines.</em>
            </h2>
            <div className="timeline">
              {experience.map(([date, company, role, description]) => (
                <article key={company}>
                  <span className="eyebrow">{date}</span>
                  <div>
                    <h3>{company}</h3>
                    <span className="role">{role}</span>
                    <p>{description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="about section" id="about">
          <p className="eyebrow">03 / A LITTLE CONTEXT</p>
          <div className="about-layout">
            <h2>
              Curiosity,
              <br />
              with <em>structure.</em>
            </h2>
            <div>
              <p className="about-lead">
                My path into software started with a question: how can we make
                complex information more useful?
              </p>
              <p>
                Economics, mathematics and statistics led me to quantitative
                finance at WU Vienna, then to risk, data and applied AI. Today,
                I bring those perspectives to building software and agent
                systems.
              </p>
              <a
                className="inline-link"
                href="/Ayush_Bhattacharya_CV.pdf"
                target="_blank"
                rel="noreferrer"
              >
                View my CV <ArrowUpRight size={18} />
              </a>
            </div>
          </div>
        </section>
        <footer className="section contact" id="contact">
          <p className="eyebrow">HAVE SOMETHING IN MIND?</p>
          <h2>
            Let’s make it
            <br />
            <em>worth building.</em>
          </h2>
          <a
            className="inline-link contact-link"
            href="mailto:bhatt.ayush.1998@gmail.com"
          >
            Get in touch <ArrowUpRight />
          </a>
          <div className="footer-bottom">
            <span>AYUSH BHATTACHARYA · VIENNA</span>
            <div>
              <a
                href="https://github.com/Ayushbh6"
                target="_blank"
                rel="noreferrer"
              >
                GitHub <ArrowUpRight size={13} aria-hidden="true" />
              </a>
              <a
                href="/Ayush_Bhattacharya_CV.pdf"
                target="_blank"
                rel="noreferrer"
              >
                CV <ArrowUpRight size={13} aria-hidden="true" />
              </a>
              <a href="/privacy/">Privacy</a>
            </div>
            <span>THOUGHTFULLY BUILT.</span>
          </div>
        </footer>
      </main>
      {canvas && (
        <Conversation
          initialMode={canvas.mode}
          initialProject={canvas.project}
          onClose={close}
        />
      )}
    </>
  );
}
