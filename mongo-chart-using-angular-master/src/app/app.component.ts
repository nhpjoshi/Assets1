import { Component } from '@angular/core';
import {GoogleLoginProvider, SocialAuthService} from "@abacritt/angularx-social-login";

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'mongo-chart-using-angular';
  show: boolean = false;

  constructor(private authService: SocialAuthService) {
  }

  showChartType: string | undefined = 'none';

  refreshToken(): void {
    this.authService.refreshAuthToken(GoogleLoginProvider.PROVIDER_ID).then(token => {
      console.log(token)
    });
  }

  changeType($event: any) {
    this.showChartType = $event.target.value
  }

  loginWithGoogle() {
    this.authService.signIn(GoogleLoginProvider.PROVIDER_ID)
      .then((token) => {
        console.log(token)
      });
  }
}
