include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-be7000-radio
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=Xiaomi BE7000 dual/tri-band 5 GHz radio mode
LUCI_DEPENDS:=@TARGET_qualcommbe_ipq95xx +luci-base +rpcd +jshn +iw
LUCI_PKGARCH:=all
LUCI_DEFAULT:=y

# Built by default so the package exists in the apk repository; it is still
# installed only on xiaomi_be7000 via DEVICE_PACKAGES in ipq95xx.mk.
# The LuCI view is gated by board_name, so BE10000 never shows the app.

define Package/$(PKG_NAME)/conffiles
/etc/config/be7000_radio
endef

include $(TOPDIR)/feeds/luci/luci.mk
