import { describe, expect, it } from 'vitest';
import { flushJobs } from '@lami.js/runtime';
import { defineAsWebComponent } from '../src';

describe('defineAsWebComponent', () => {
  it('renders bindables and reacts to later attribute changes', async () => {
    const tagName = `lami-test-${Math.random().toString(36).slice(2)}`;

    class UserBadge {
      name = '';
    }

    defineAsWebComponent({
      name: tagName,
      Type: UserBadge,
      template: '<span>${name}</span>',
      bindables: {
        name: {}
      },
      shadow: false
    });

    document.body.innerHTML = `<${tagName} name="Ada"></${tagName}>`;
    const element = document.querySelector(tagName)!;

    expect(element.querySelector('span')!.textContent).toBe('Ada');

    element.setAttribute('name', 'Grace');
    await flushJobs();

    expect(element.querySelector('span')!.textContent).toBe('Grace');
  });
});
