import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { SubscriptionBlocked } from './subscription-blocked';

describe('SubscriptionBlocked', () => {
  let component: SubscriptionBlocked;
  let fixture: ComponentFixture<SubscriptionBlocked>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubscriptionBlocked],
      providers: [provideRouter([]), provideHttpClient()],
    }).compileComponents();

    fixture = TestBed.createComponent(SubscriptionBlocked);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
