import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { MyOrders } from './my-orders';

describe('MyOrders', () => {
  let component: MyOrders;
  let fixture: ComponentFixture<MyOrders>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyOrders],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MyOrders);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
