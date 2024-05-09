import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { StoreModule } from '@ngrx/store';
import { SimulationsComponent } from './simulations.component';

describe('SimulationsComponent', () => {
  let component: SimulationsComponent;
  let fixture: ComponentFixture<SimulationsComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      imports: [FormsModule, StoreModule.forRoot([])],
      declarations: [SimulationsComponent],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SimulationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should clear value on main thread input', () => {
    component.mainThreadCount = 4000;
    component.clear();
    expect(component.mainThreadCount).toEqual(0);
  });

  it('should toggle value ', () => {
    component.toggleResponsive();
    expect(component.responsiveToggle).toEqual(true);
  });

  it('check prime func for less than 2', () => {
    expect(component.isPrime(1)).toBeFalsy();
  });

  it('check prime func for actual prime', () => {
    expect(component.isPrime(7)).toBeTruthy();
  });

  it('check prime func for actual prime', () => {
    expect(component.isPrime(40)).toBeFalsy();
  });
});
