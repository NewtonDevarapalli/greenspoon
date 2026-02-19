import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AdminDispatch } from './admin-dispatch';

describe('AdminDispatch', () => {
  let component: AdminDispatch;
  let fixture: ComponentFixture<AdminDispatch>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminDispatch],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminDispatch);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
