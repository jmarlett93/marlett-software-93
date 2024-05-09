import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { WheelItemComponent } from './wheel-item.component';
import { AngularFontAwesomeModule } from 'angular-font-awesome';

describe('WheelItemComponent', () => {
  let component: WheelItemComponent;
  let fixture: ComponentFixture<WheelItemComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      imports: [AngularFontAwesomeModule],
      declarations: [WheelItemComponent],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(WheelItemComponent);
    component = fixture.componentInstance;
    component.wheelItem = {
      icon: 'github',
      href: 'https://github.com/jmarlett93',
      text: 'GitHub Profile',
    };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
