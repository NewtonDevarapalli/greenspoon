import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminTenants } from './admin-tenants';

describe('AdminTenants', () => {
  let component: AdminTenants;
  let fixture: ComponentFixture<AdminTenants>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminTenants],
      providers: [provideHttpClient()],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminTenants);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
