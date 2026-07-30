

#include "esp_err.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "app_wifi.h"
#include "servo_dog_ctrl.h"
#include "esp_hi_web_control.h"

static const char *TAG = "main";

void app_main(void)
{
    // NVS is required by both WiFi and the servo calibration storage
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Bring up WiFi first so the webserver/mDNS have a network to bind to
    app_wifi_init();

    // Map these to whichever GPIOs your four leg servos are actually wired to
    ESP_LOGI(TAG, "Initializing servo dog controller");
    servo_dog_ctrl_config_t config = {
        .fl_gpio_num = 21,
        .fr_gpio_num = 19,
        .bl_gpio_num = 20,
        .br_gpio_num = 18,
    };
    ESP_ERROR_CHECK(servo_dog_ctrl_init(&config));

    // Starts the local webserver + mDNS (http://esp-hi.local)
    ESP_ERROR_CHECK(esp_hi_web_control_server_init());
}
