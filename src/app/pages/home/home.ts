import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

type SocialLink = {
  label: string;
  href: string;
  icon: string;
};

@Component({
  selector: 'app-home',
  imports: [RouterLink, MatIconModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  readonly socialLinks: readonly SocialLink[] = [
    {
      label: 'GitHub',
      href: 'https://github.com/jmarlett93',
      icon: 'code',
    },
    {
      label: 'LinkedIn',
      href: 'https://www.linkedin.com/in/johnmarlett93/',
      icon: 'work',
    },
    {
      label: 'Blog',
      href: 'https://johnmarlett.substack.com/',
      icon: 'article',
    },
    {
      label: 'X',
      href: 'https://x.com/JohnMarlett1',
      icon: 'alternate_email',
    },
  ];
}
