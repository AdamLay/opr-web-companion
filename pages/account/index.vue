<template>
  <v-container>

    <opr-breadcrumbs-row :items="breadcrumbItems"></opr-breadcrumbs-row>

    <v-row>

      <v-col cols="12">
        <v-card>
          <v-card-title>{{ $auth.user.username }}</v-card-title>
          <v-card-subtitle>Registered user since <span>{{ new Date(createdAt).toLocaleDateString() }}</span></v-card-subtitle>
          <v-card-text></v-card-text>
        </v-card>
      </v-col>

    </v-row>

    <v-row>
      <v-col cols="8">
        <v-text-field
          label="Username"
          dense outlined
          v-model="username"
        ></v-text-field>
      </v-col>
      <v-col cols="8">
        <v-text-field
          label="Email"
          dense outlined disabled
          v-model="email"
        ></v-text-field>
      </v-col>
    </v-row>

  </v-container>
</template>

<script>
import OprBreadcrumbsRow from "../../components/shared/OprBreadcrumbsRow";
export default {
  name: 'account-index',
  components: {OprBreadcrumbsRow},
  middleware: 'auth',
  async asyncData({ $axios }) {
    const { data } = await $axios.get('/api/auth/user');
    const { username, email, createdAt } = data.user;
    return {
      username,
      email,
      createdAt,
    };
  },
  data() {
    return {
      breadcrumbItems: [
        { text: '', to: '/', exact: true },
        { text: 'Account', to: '/account', exact: true },
      ],
    };
  },
  head() {
    return {
      title: 'My Account',
    };
  },
}
</script>

<style scoped>

</style>
