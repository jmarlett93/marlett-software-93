import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { HeroSectionComponent } from '../hero-section/hero-section.component';
import { HomeComponent } from './home.component';
import { AboutSectionComponent } from '../about-section/about-section.component';
import {AngularFontAwesomeModule} from 'angular-font-awesome';
import {WheelItemComponent} from '../wheel-item/wheel-item.component';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      imports: [ AngularFontAwesomeModule ],
      declarations: [ HomeComponent,
        HeroSectionComponent, AboutSectionComponent, WheelItemComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
