import {Component, OnInit} from '@angular/core';
import {ChartService} from "../../service/chart-service/chart.service";
import {CustomLoginService} from "../../service/custom-login-service/custom-login.service";


@Component({
  selector: 'app-single-chart',
  templateUrl: './single-chart.component.html',
  styleUrls: ['./single-chart.component.css']
})
export class SingleChartComponent implements OnInit {

  constructor(private chartService: ChartService,private customLoginService: CustomLoginService) {
  }
  ngOnInit() {
    setTimeout(async () => {
      await this.tryLogin();
    })
  }

  async tryLogin() {
    const token = await this.customLoginService.login()

    if(token) {
      await this.renderSingleChart(token)
    }
  }
  private async renderSingleChart(token: string) {
    document.getElementById('chart')!.style.visibility = 'visible';
    const chart = this.chartService.
    createSingleChart('https://charts.mongodb.com/charts-nitish-kxpji',
      '65fbcc32-4b94-481a-806c-5148af6d3485',token);

    await chart
      .render(document.getElementById('chart')!)
      .catch(() => window.alert('Chart failed to initialise'));

  }

}
