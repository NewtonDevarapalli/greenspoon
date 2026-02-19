import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminOrders } from './admin-orders';

describe('AdminOrders', () => {
  let component: AdminOrders;
  let fixture: ComponentFixture<AdminOrders>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminOrders],
      providers: [provideHttpClient()],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminOrders);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
