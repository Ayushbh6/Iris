"use client";

import { useId, useState } from "react";
import { ArrowRight, ArrowUpRight, GitBranch } from "lucide-react";
import { projects, type ProjectId } from "../lib/content";
import ProjectVisual from "./ProjectVisual";

export default function ProjectCaseStudy({
  projectId,
  emphasis,
}: {
  projectId: ProjectId;
  emphasis?: string;
}) {
  const project = projects.find((p) => p.id === projectId)!;
  const [step, setStep] = useState(0);
  const panelId = useId();
  const current = project.workflow[step];
  return (
    <article className={`project-case case-${projectId}`}>
      <header className="case-header">
        <p className="eyebrow">
          SELECTED WORK / {project.number} · {project.category}
        </p>
        <h2 id="canvas-title">{project.name}</h2>
        <p className="case-subtitle">{project.subtitle}</p>
        <p className="case-summary">{project.detail}</p>
        {emphasis && <p className="gv-emphasis">{emphasis}</p>}
        <div className="case-meta">
          <span>
            <i />
            {project.status}
          </span>
          <a href={project.repo} target="_blank" rel="noreferrer">
            View repository <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </header>

      <section
        className="case-workflow"
        aria-label={`${project.name} workflow`}
      >
        <figure className="case-figure">
          <ProjectVisual project={projectId} active={step} />
          <figcaption>
            Workflow illustration <span>Explore the steps below</span>
          </figcaption>
        </figure>
        <div className="case-steps" role="group" aria-label="Workflow steps">
          {project.workflow.map((item, i) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={step === i}
              aria-controls={panelId}
              onClick={() => setStep(i)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {item.label}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div
          id={panelId}
          className="case-step-detail"
          aria-live="polite"
          aria-atomic="true"
        >
          <div key={step}>
            <h3>{current.title}</h3>
            <p>{current.body}</p>
          </div>
        </div>
      </section>

      <section className="case-question">
        <p className="eyebrow">THE DESIGN QUESTION</p>
        <h3>{project.question}</h3>
        <p>{project.approach}</p>
      </section>
      <section className="case-build" aria-label="Implementation details">
        <p className="eyebrow">INSIDE THE BUILD</p>
        {project.features.map((feature, i) => (
          <div className="case-feature" key={feature.title}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </div>
        ))}
      </section>
      <section className="case-foundation">
        <div>
          <p className="eyebrow">BUILT WITH</p>
          <ul>
            {project.stack.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <p className="case-takeaway">{project.takeaway}</p>
      </section>
      <footer className="case-footer">
        <p>{project.scope}</p>
        <a href={project.source} target="_blank" rel="noreferrer">
          <GitBranch size={16} aria-hidden="true" />
          {project.sourceLabel}
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </footer>
    </article>
  );
}
