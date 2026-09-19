<script lang="ts">
  import Building2Icon from "@lucide/svelte/icons/building-2";
  import ClipboardCheckIcon from "@lucide/svelte/icons/clipboard-check";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import LeafIcon from "@lucide/svelte/icons/leaf";
  import MessageSquareIcon from "@lucide/svelte/icons/message-square";
  import PackageIcon from "@lucide/svelte/icons/package";
  import ScrollTextIcon from "@lucide/svelte/icons/scroll-text";
  import * as Avatar from "$lib/components/ui/avatar/index.js";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { CONSOLE_NAV, isCurrentRoute, type ConsoleNavIcon } from "$lib/console-nav";

  let {
    user,
    pathname,
    sidebarOpen = true,
    breadcrumbs = [],
    children,
  }: {
    user: { name: string; email: string };
    pathname: string;
    sidebarOpen?: boolean;
    breadcrumbs?: { label: string; href?: string }[];
    children?: import("svelte").Snippet;
  } = $props();

  const ICONS: Record<ConsoleNavIcon, typeof LayoutDashboardIcon> = {
    dashboard: LayoutDashboardIcon,
    application: ClipboardCheckIcon,
    organization: Building2Icon,
    order: PackageIcon,
    inquiry: MessageSquareIcon,
    auditLog: ScrollTextIcon,
  };
</script>

<Sidebar.Provider open={sidebarOpen}>
  <!-- Ahead of the sidebar in the DOM, or reaching the content costs a tab stop per nav entry on every screen. -->
  <a href="#main-content" class="sr-only rounded-md focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground">本文へスキップ</a>

  <Sidebar.Root collapsible="icon">
    <Sidebar.Header>
      <Sidebar.Menu>
        <Sidebar.MenuItem>
          <Sidebar.MenuButton size="lg">
            {#snippet child({ props })}
              <a href="/" {...props}>
                <div class="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <LeafIcon />
                </div>
                <div class="grid flex-1 text-left leading-tight">
                  <span class="truncate font-medium">ペット漢方 卸売</span>
                  <span class="truncate text-xs text-muted-foreground">管理画面</span>
                </div>
              </a>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
    </Sidebar.Header>

    <Sidebar.Content>
      <!-- Sidebar.Content is a plain div, and the nav landmark has to come from somewhere. -->
      <nav aria-label="管理メニュー" class="flex flex-col gap-2">
        {#each CONSOLE_NAV as group, groupIndex (group.label ?? "root")}
          {@const labelId = `console-nav-group-${groupIndex}`}
          <Sidebar.Group>
            {#if group.label}
              <Sidebar.GroupLabel id={labelId}>{group.label}</Sidebar.GroupLabel>
            {/if}
            <Sidebar.GroupContent>
              <Sidebar.Menu aria-labelledby={group.label ? labelId : undefined}>
                {#each group.items as item (item.href)}
                  {@const current = isCurrentRoute(pathname, item.href)}
                  {@const Icon = ICONS[item.icon]}
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton isActive={current} tooltipContent={item.label}>
                      {#snippet child({ props })}
                        <a href={item.href} aria-current={current ? "page" : undefined} {...props}>
                          <Icon />
                          <span>{item.label}</span>
                        </a>
                      {/snippet}
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                {/each}
              </Sidebar.Menu>
            </Sidebar.GroupContent>
          </Sidebar.Group>
        {/each}
      </nav>
    </Sidebar.Content>

    <Sidebar.Footer>
      <!-- Static, unlike the template's user menu: there is no app-level session to end here, and
           a second door into apps/admin is exactly what D-022 removed. -->
      <div class="flex items-center gap-2 overflow-hidden rounded-lg px-3 py-2 group-data-[collapsible=icon]:p-2!" title={`${user.name}（${user.email}）`}>
        <!-- The initial is decoration next to the name it was cut from; announcing it twice adds nothing. -->
        <Avatar.Root class="size-8 rounded-lg" aria-hidden="true">
          <Avatar.Fallback class="rounded-lg">{user.name.slice(0, 1)}</Avatar.Fallback>
        </Avatar.Root>
        <div class="grid flex-1 text-left text-sm leading-tight">
          <span class="truncate font-medium">{user.name}</span>
          <span class="truncate text-xs text-muted-foreground">{user.email}</span>
        </div>
      </div>
    </Sidebar.Footer>
    <!-- The vendored primitives label themselves in English; aria-label wins over their sr-only text. -->
    <Sidebar.Rail aria-label="サイドナビを開閉" title="サイドナビを開閉" />
  </Sidebar.Root>

  <Sidebar.Inset id="main-content">
    <header class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <Sidebar.Trigger class="-ms-1" aria-label="サイドナビを開閉" />
      <Separator orientation="vertical" class="me-1 h-4" />
      <Breadcrumb.Root>
        <Breadcrumb.List>
          {#each breadcrumbs as crumb, index (crumb.label)}
            {#if index > 0}
              <Breadcrumb.Separator />
            {/if}
            <Breadcrumb.Item>
              {#if crumb.href}
                <Breadcrumb.Link href={crumb.href}>{crumb.label}</Breadcrumb.Link>
              {:else}
                <Breadcrumb.Page>{crumb.label}</Breadcrumb.Page>
              {/if}
            </Breadcrumb.Item>
          {/each}
        </Breadcrumb.List>
      </Breadcrumb.Root>
    </header>

    <div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {@render children?.()}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
