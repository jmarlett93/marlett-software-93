import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

type Link = { label: string; href: string };

type LedgerEntry = {
  term: string;
  text: string;
  linkText?: string;
  href?: string;
};

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  readonly links: readonly Link[] = [
    { label: 'Writing', href: 'https://johnmarlett.substack.com/' },
    { label: 'GitHub', href: 'https://github.com/jmarlett93' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/johnmarlett93/' },
    { label: 'X', href: 'https://x.com/JohnMarlett1' },
  ];

  readonly ledger: readonly LedgerEntry[] = [
    {
      term: 'Now',
      linkText: 'Crexi',
      href: 'https://crexi.com',
      text: '— AI agents and full-stack products for commercial real estate. Node, LangGraph, AWS.',
    },
    {
      term: '2024',
      linkText: 'Quaestor',
      href: 'https://qstr.cursus.tools/login',
      text: '— founder, engineering. Quaestor understands your business and it will run without you.',
    },
    {
      term: 'Open Source',
      linkText: 'Semper Nova AI',
      href: 'https://github.com/semper-nova-tech/pallas-skema',
      text: '- Skema, a diagraming tool for agents, and other AI native tooling for the agentic era. '
    },
    { term: 'Interests', text: 'Elegant design, building teams, writing.' },
    { term: 'Off hours', text: 'A dry martini. Playing rugby. Art. Reading.' },
  ];

  // Base href breaks bare `#id` links, so scroll manually.
  scrollToAbout(event: Event): void {
    event.preventDefault();
    document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
