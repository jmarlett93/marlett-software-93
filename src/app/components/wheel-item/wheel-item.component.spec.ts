import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { WheelItemComponent } from './wheel-item.component';

describe('WheelItemComponent', () => {
  let component: WheelItemComponent;
  let fixture: ComponentFixture<WheelItemComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ WheelItemComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(WheelItemComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
