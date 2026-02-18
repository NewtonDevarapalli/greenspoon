import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './header/header';


@Component({
selector: 'app-root',
standalone: true,
imports: [RouterOutlet, Header],
template: `
<app-header></app-header>
<router-outlet></router-outlet>
`
})
export class App {}