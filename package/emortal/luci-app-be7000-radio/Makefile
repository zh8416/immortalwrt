include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-be7000-radio
PKG_VERSION:=1.0.0
PKG_RELEASE:=3
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=zh8416
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-be7000-radio
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Xiaomi BE7000 dual/tri-band 5 GHz radio mode
  DEPENDS:=+luci-base +rpcd +jshn +iw
  PKGARCH:=all
  CONFFILES:=/etc/config/be7000_radio
endef

define Package/luci-app-be7000-radio/description
  Dual/tri-band 5 GHz radio mode switch for the Xiaomi BE7000 (ipq95xx).

  Built as a plain package so it is unconditionally registered in the package
  repository; it is still installed only on xiaomi,be7000 via DEVICE_PACKAGES
  in target/linux/qualcommbe/image/ipq95xx.mk. The LuCI view ships in this
  package (network/be7000-radio) and the menu entry is gated by the package's
  rpcd ACL, so no other model ever sees the app - no build-time patching needed.
endef

define Package/luci-app-be7000-radio/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload 2>/dev/null
	exit 0
}
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/luci-app-be7000-radio/install
	$(INSTALL_DIR) $(1)/
	$(CP) ./root/* $(1)/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/network
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/network/be7000-radio.js \
		$(1)/www/luci-static/resources/view/network/
	chmod 0755 $(1)/etc/init.d/be7000-radio \
		$(1)/usr/libexec/be7000-radio \
		$(1)/usr/libexec/rpcd/be7000.radio
endef

$(eval $(call BuildPackage,luci-app-be7000-radio))
