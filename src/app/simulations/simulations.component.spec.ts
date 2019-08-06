import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { SimulationsComponent } from './simulations.component';

describe('SimulationsComponent', () => {
  let component: SimulationsComponent;
  let fixture: ComponentFixture<SimulationsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ SimulationsComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SimulationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
